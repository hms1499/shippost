import { describe, it } from 'node:test';
import { expect } from 'chai';
import { network } from 'hardhat';

const ZERO = '0x0000000000000000000000000000000000000000';

// The price is $0.10, so a thread costs 10^17 in an 18-decimal token and
// 100_000 in a 6-decimal one.
const TEN_CENT_18 = 10n ** 17n;
const TEN_CENT_6 = 100_000n;
// Ceiling for the tests that are not about pricing — high enough never to bind.
const NO_CEILING = 10n ** 30n;

// Deploy helper: constructor is (agentWallet, treasury, startThreadId). Reserve
// is retained in-contract, so there is no reservePool address any more.
async function deployPayment(viem: any, agent: string, treasury: string, startThreadId = 0n) {
  return viem.deployContract('ShipPostPayment', [agent, treasury, startThreadId]);
}

// chai-as-promised is not installed, and a bare "did it throw" would also pass
// on an arity or encoding error. Assert the revert reason itself.
async function expectRevert(p: Promise<unknown>, pattern: RegExp) {
  let reverted = false;
  try {
    await p;
  } catch (e: any) {
    reverted = pattern.test(e.message);
  }
  expect(reverted).to.equal(true);
}

describe('ShipPostPayment', () => {
  it('deploys with correct initial state', async () => {
    const { viem } = await network.create();
    const [, agentWallet, treasury] = await viem.getWalletClients();

    const payment = await deployPayment(viem, agentWallet.account.address, treasury.account.address);

    expect((await payment.read.agentWallet()).toLowerCase()).to.equal(
      agentWallet.account.address.toLowerCase()
    );
    expect((await payment.read.treasury()).toLowerCase()).to.equal(
      treasury.account.address.toLowerCase()
    );
    expect(await payment.read.threadCounter()).to.equal(0n);
  });

  it('honors a start thread id so a redeploy cannot collide with old ids', async () => {
    const { viem } = await network.create();
    const [, agentWallet, treasury, user] = await viem.getWalletClients();

    const cusd = await viem.deployContract('MockERC20', ['Celo Dollar', 'cUSD', 18]);
    const payment = await deployPayment(
      viem,
      agentWallet.account.address,
      treasury.account.address,
      100000n
    );
    await payment.write.setAllowedToken([cusd.address, true]);
    await cusd.write.mint([user.account.address, 10n ** 18n]);
    await cusd.write.approve([payment.address, TEN_CENT_18], { account: user.account });

    const id = await payment.simulate.payForThread([cusd.address, 0, NO_CEILING], {
      account: user.account,
    });
    expect(id.result).to.equal(100001n);
    await payment.write.payForThread([cusd.address, 0, NO_CEILING], { account: user.account });
    expect(await payment.read.threadCounter()).to.equal(100001n);
  });

  it('accepts 0.10 cUSD, splits 50/40, and retains the 10% reserve in-contract', async () => {
    const { viem } = await network.create();
    const [, agentWallet, treasury, user] = await viem.getWalletClients();

    const cusd = await viem.deployContract('MockERC20', ['Celo Dollar', 'cUSD', 18]);
    const payment = await deployPayment(viem, agentWallet.account.address, treasury.account.address);
    await payment.write.setAllowedToken([cusd.address, true]);

    await cusd.write.mint([user.account.address, 10n ** 18n]);
    await cusd.write.approve([payment.address, TEN_CENT_18], { account: user.account });
    await payment.write.payForThread([cusd.address, 0, NO_CEILING], { account: user.account });

    // 0.05 agent / 0.04 treasury / 0.01 reserve held by the contract itself
    expect(await cusd.read.balanceOf([agentWallet.account.address])).to.equal(5n * 10n ** 16n);
    expect(await cusd.read.balanceOf([treasury.account.address])).to.equal(4n * 10n ** 16n);
    expect(await cusd.read.balanceOf([payment.address])).to.equal(10n ** 16n);
    expect(await payment.read.threadCounter()).to.equal(1n);
  });

  it('accepts 0.10 USDT (6 decimals) with the reserve retained', async () => {
    const { viem } = await network.create();
    const [, agentWallet, treasury, user] = await viem.getWalletClients();

    const usdt = await viem.deployContract('MockERC20', ['Tether USD', 'USDT', 6]);
    const payment = await deployPayment(viem, agentWallet.account.address, treasury.account.address);
    await payment.write.setAllowedToken([usdt.address, true]);

    await usdt.write.mint([user.account.address, 1_000_000n]);
    await usdt.write.approve([payment.address, TEN_CENT_6], { account: user.account });
    await payment.write.payForThread([usdt.address, 0, NO_CEILING], { account: user.account });

    expect(await usdt.read.balanceOf([agentWallet.account.address])).to.equal(50_000n);
    expect(await usdt.read.balanceOf([treasury.account.address])).to.equal(40_000n);
    expect(await usdt.read.balanceOf([payment.address])).to.equal(10_000n);
  });

  it('reverts when token is not whitelisted', async () => {
    const { viem } = await network.create();
    const [, agentWallet, treasury, user] = await viem.getWalletClients();

    const rando = await viem.deployContract('MockERC20', ['Random', 'RND', 18]);
    const payment = await deployPayment(viem, agentWallet.account.address, treasury.account.address);

    await rando.write.mint([user.account.address, 10n ** 18n]);
    await rando.write.approve([payment.address, 10n ** 17n], { account: user.account });

    let reverted = false;
    try {
      await payment.write.payForThread([rando.address, 0, NO_CEILING], { account: user.account });
    } catch (e: any) {
      reverted = /TOKEN_NOT_ALLOWED/.test(e.message);
    }
    expect(reverted).to.equal(true);
  });

  it('emits ThreadRequested with correct args', async () => {
    const { viem } = await network.create();
    const publicClient = await viem.getPublicClient();
    const [, agentWallet, treasury, user] = await viem.getWalletClients();

    const cusd = await viem.deployContract('MockERC20', ['Celo Dollar', 'cUSD', 18]);
    const payment = await deployPayment(viem, agentWallet.account.address, treasury.account.address);
    await payment.write.setAllowedToken([cusd.address, true]);
    await cusd.write.mint([user.account.address, 10n ** 18n]);
    await cusd.write.approve([payment.address, TEN_CENT_18], { account: user.account });

    const hash = await payment.write.payForThread([cusd.address, 2, NO_CEILING], {
      account: user.account,
    });
    await publicClient.waitForTransactionReceipt({ hash });

    const logs = await publicClient.getContractEvents({
      address: payment.address,
      abi: payment.abi,
      eventName: 'ThreadRequested',
    });
    expect(logs.length).to.equal(1);
    const log = logs[0] as any;
    expect(log.args.user.toLowerCase()).to.equal(user.account.address.toLowerCase());
    expect(log.args.threadId).to.equal(1n);
    expect(log.args.mode).to.equal(2);
    expect(log.args.token.toLowerCase()).to.equal(cusd.address.toLowerCase());
    expect(log.args.amount).to.equal(TEN_CENT_18);
  });

  it('owner can redirect treasury/agentWallet and splits follow', async () => {
    const { viem } = await network.create();
    const [, agentWallet, treasury, user, newTreasury, newAgent] = await viem.getWalletClients();

    const cusd = await viem.deployContract('MockERC20', ['Celo Dollar', 'cUSD', 18]);
    const payment = await deployPayment(viem, agentWallet.account.address, treasury.account.address);
    await payment.write.setAllowedToken([cusd.address, true]);

    await payment.write.setAgentWallet([newAgent.account.address]);
    await payment.write.setTreasury([newTreasury.account.address]);

    expect((await payment.read.agentWallet()).toLowerCase()).to.equal(
      newAgent.account.address.toLowerCase()
    );
    expect((await payment.read.treasury()).toLowerCase()).to.equal(
      newTreasury.account.address.toLowerCase()
    );

    await cusd.write.mint([user.account.address, 10n ** 18n]);
    await cusd.write.approve([payment.address, TEN_CENT_18], { account: user.account });
    await payment.write.payForThread([cusd.address, 0, NO_CEILING], { account: user.account });

    expect(await cusd.read.balanceOf([newAgent.account.address])).to.equal(5n * 10n ** 16n);
    expect(await cusd.read.balanceOf([newTreasury.account.address])).to.equal(4n * 10n ** 16n);
    // Old addresses receive nothing after redirection
    expect(await cusd.read.balanceOf([treasury.account.address])).to.equal(0n);
  });

  it('setters reject zero address and non-owner callers', async () => {
    const { viem } = await network.create();
    const [, agentWallet, treasury, attacker] = await viem.getWalletClients();

    const payment = await deployPayment(viem, agentWallet.account.address, treasury.account.address);

    let zeroReverted = false;
    try {
      await payment.write.setTreasury([ZERO]);
    } catch (e: any) {
      zeroReverted = /ZERO_ADDR/.test(e.message);
    }
    expect(zeroReverted).to.equal(true);

    let authReverted = false;
    try {
      await payment.write.setTreasury([attacker.account.address], { account: attacker.account });
    } catch (e: any) {
      authReverted = /OwnableUnauthorizedAccount|Ownable/.test(e.message);
    }
    expect(authReverted).to.equal(true);
  });

  it('blocks payForThread when paused', async () => {
    const { viem } = await network.create();
    const [, agentWallet, treasury, user] = await viem.getWalletClients();

    const cusd = await viem.deployContract('MockERC20', ['Celo Dollar', 'cUSD', 18]);
    const payment = await deployPayment(viem, agentWallet.account.address, treasury.account.address);
    await payment.write.setAllowedToken([cusd.address, true]);
    await cusd.write.mint([user.account.address, 10n ** 18n]);
    await cusd.write.approve([payment.address, TEN_CENT_18], { account: user.account });

    await payment.write.pause();

    let reverted = false;
    try {
      await payment.write.payForThread([cusd.address, 0, NO_CEILING], { account: user.account });
    } catch (e: any) {
      reverted = /Pausable|EnforcedPause/.test(e.message);
    }
    expect(reverted).to.equal(true);
  });

  it('settles a USDT-style no-return token via SafeERC20', async () => {
    const { viem } = await network.create();
    const [, agentWallet, treasury, user] = await viem.getWalletClients();

    const usdt = await viem.deployContract('MockNoReturnERC20', ['Tether USD', 'USDT', 6]);
    const payment = await deployPayment(viem, agentWallet.account.address, treasury.account.address);
    await payment.write.setAllowedToken([usdt.address, true]);

    await usdt.write.mint([user.account.address, 1_000_000n]);
    await usdt.write.approve([payment.address, TEN_CENT_6], { account: user.account });
    await payment.write.payForThread([usdt.address, 1, NO_CEILING], { account: user.account });

    expect(await usdt.read.balanceOf([agentWallet.account.address])).to.equal(50_000n);
    expect(await usdt.read.balanceOf([treasury.account.address])).to.equal(40_000n);
    expect(await usdt.read.balanceOf([payment.address])).to.equal(10_000n);
  });

  // --- refund (reserve-funded) ---

  // Pay `count` threads so the contract holds `count * reserveShare` of reserve.
  async function seedReserve(viem: any, payment: any, cusd: any, user: any, count: number) {
    await cusd.write.mint([user.account.address, TEN_CENT_18 * BigInt(count)]);
    for (let i = 0; i < count; i++) {
      await cusd.write.approve([payment.address, TEN_CENT_18], { account: user.account });
      await payment.write.payForThread([cusd.address, 0, NO_CEILING], { account: user.account });
    }
  }

  it('refunds a thread from the reserve and marks it refunded', async () => {
    const { viem } = await network.create();
    const [, agentWallet, treasury, user] = await viem.getWalletClients();

    const cusd = await viem.deployContract('MockERC20', ['Celo Dollar', 'cUSD', 18]);
    const payment = await deployPayment(viem, agentWallet.account.address, treasury.account.address);
    await payment.write.setAllowedToken([cusd.address, true]);
    // 10 threads => reserve = 10 * 0.01 = 0.10 cUSD, exactly one full refund.
    await seedReserve(viem, payment, cusd, user, 10);

    const before = await cusd.read.balanceOf([user.account.address]);
    await payment.write.refund([1n, cusd.address, user.account.address, TEN_CENT_18]);

    expect(await cusd.read.balanceOf([user.account.address])).to.equal(before + TEN_CENT_18);
    expect(await cusd.read.balanceOf([payment.address])).to.equal(0n);
    expect(await payment.read.refunded([1n])).to.equal(true);
  });

  it('reverts a second refund of the same thread (idempotent)', async () => {
    const { viem } = await network.create();
    const [, agentWallet, treasury, user] = await viem.getWalletClients();

    const cusd = await viem.deployContract('MockERC20', ['Celo Dollar', 'cUSD', 18]);
    const payment = await deployPayment(viem, agentWallet.account.address, treasury.account.address);
    await payment.write.setAllowedToken([cusd.address, true]);
    await seedReserve(viem, payment, cusd, user, 20);

    const oneCent = 10n ** 16n; // 0.01, small so reserve covers twice
    await payment.write.refund([1n, cusd.address, user.account.address, oneCent]);

    let reverted = false;
    try {
      await payment.write.refund([1n, cusd.address, user.account.address, oneCent]);
    } catch (e: any) {
      reverted = /ALREADY_REFUNDED/.test(e.message);
    }
    expect(reverted).to.equal(true);
  });

  it('reverts a refund larger than the held reserve', async () => {
    const { viem } = await network.create();
    const [, agentWallet, treasury, user] = await viem.getWalletClients();

    const cusd = await viem.deployContract('MockERC20', ['Celo Dollar', 'cUSD', 18]);
    const payment = await deployPayment(viem, agentWallet.account.address, treasury.account.address);
    await payment.write.setAllowedToken([cusd.address, true]);
    await seedReserve(viem, payment, cusd, user, 1); // reserve = 0.01 cUSD

    let reverted = false;
    try {
      await payment.write.refund([1n, cusd.address, user.account.address, TEN_CENT_18]);
    } catch (e: any) {
      reverted = /RESERVE_INSUFFICIENT/.test(e.message);
    }
    expect(reverted).to.equal(true);
  });

  it('lets a non-owner never refund, but the owner can even while paused', async () => {
    const { viem } = await network.create();
    const [, agentWallet, treasury, user, attacker] = await viem.getWalletClients();

    const cusd = await viem.deployContract('MockERC20', ['Celo Dollar', 'cUSD', 18]);
    const payment = await deployPayment(viem, agentWallet.account.address, treasury.account.address);
    await payment.write.setAllowedToken([cusd.address, true]);
    await seedReserve(viem, payment, cusd, user, 10);

    let authReverted = false;
    try {
      await payment.write.refund([1n, cusd.address, user.account.address, 10n ** 16n], {
        account: attacker.account,
      });
    } catch (e: any) {
      authReverted = /OwnableUnauthorizedAccount|Ownable/.test(e.message);
    }
    expect(authReverted).to.equal(true);

    // Paused must NOT block a refund — the owner must always make users whole.
    await payment.write.pause();
    await payment.write.refund([2n, cusd.address, user.account.address, 10n ** 16n]);
    expect(await payment.read.refunded([2n])).to.equal(true);
  });

  it('lets the owner withdraw excess reserve, capped by the balance', async () => {
    const { viem } = await network.create();
    const [, agentWallet, treasury, user] = await viem.getWalletClients();

    const cusd = await viem.deployContract('MockERC20', ['Celo Dollar', 'cUSD', 18]);
    const payment = await deployPayment(viem, agentWallet.account.address, treasury.account.address);
    await payment.write.setAllowedToken([cusd.address, true]);
    await seedReserve(viem, payment, cusd, user, 4); // reserve = 0.04 cUSD

    const reserve = await cusd.read.balanceOf([payment.address]);
    const treasuryBefore = await cusd.read.balanceOf([treasury.account.address]);
    await payment.write.withdrawReserve([cusd.address, treasury.account.address, reserve]);
    expect(await cusd.read.balanceOf([treasury.account.address])).to.equal(
      treasuryBefore + reserve // its accumulated split share plus the swept reserve
    );
    expect(await cusd.read.balanceOf([payment.address])).to.equal(0n);

    let reverted = false;
    try {
      await payment.write.withdrawReserve([cusd.address, treasury.account.address, 1n]);
    } catch (e: any) {
      reverted = /RESERVE_INSUFFICIENT/.test(e.message);
    }
    expect(reverted).to.equal(true);
  });
});

describe('settable price', () => {
  it('defaults to 10 cents and scales to each token decimals', async () => {
    const { viem } = await network.create();
    const [, agentWallet, treasury] = await viem.getWalletClients();
    const payment = await deployPayment(viem, agentWallet.account.address, treasury.account.address);

    const cusd = await viem.deployContract('MockERC20', ['Celo Dollar', 'cUSD', 18]);
    const usdc = await viem.deployContract('MockERC20', ['USD Coin', 'USDC', 6]);

    expect(await payment.read.priceUsdCents()).to.equal(10n);
    // $0.10 = 10 * 10^(d-2)
    expect(await payment.read.requiredAmount([cusd.address])).to.equal(10n ** 17n);
    expect(await payment.read.requiredAmount([usdc.address])).to.equal(100_000n);
  });

  it('setPrice moves requiredAmount for every decimals', async () => {
    const { viem } = await network.create();
    const [, agentWallet, treasury] = await viem.getWalletClients();
    const payment = await deployPayment(viem, agentWallet.account.address, treasury.account.address);
    const usdc = await viem.deployContract('MockERC20', ['USD Coin', 'USDC', 6]);

    await payment.write.setPrice([25n]);

    expect(await payment.read.priceUsdCents()).to.equal(25n);
    expect(await payment.read.requiredAmount([usdc.address])).to.equal(250_000n);
  });

  it('setPrice is owner-only', async () => {
    const { viem } = await network.create();
    const [, agentWallet, treasury, stranger] = await viem.getWalletClients();
    const payment = await deployPayment(viem, agentWallet.account.address, treasury.account.address);

    await expectRevert(
      payment.write.setPrice([25n], { account: stranger.account }),
      /OwnableUnauthorizedAccount|Ownable/
    );
  });

  it('setPrice rejects zero', async () => {
    const { viem } = await network.create();
    const [, agentWallet, treasury] = await viem.getWalletClients();
    const payment = await deployPayment(viem, agentWallet.account.address, treasury.account.address);

    await expectRevert(payment.write.setPrice([0n]), /ZERO_PRICE/);
  });

  it('emits PriceUpdated with the previous and current price', async () => {
    const { viem } = await network.create();
    const publicClient = await viem.getPublicClient();
    const [, agentWallet, treasury] = await viem.getWalletClients();
    const payment = await deployPayment(viem, agentWallet.account.address, treasury.account.address);

    const hash = await payment.write.setPrice([25n]);
    await publicClient.waitForTransactionReceipt({ hash });

    const logs = await publicClient.getContractEvents({
      address: payment.address,
      abi: payment.abi,
      eventName: 'PriceUpdated',
    });
    expect(logs.length).to.equal(1);
    const log = logs[0] as any;
    expect(log.args.previous).to.equal(10n);
    expect(log.args.current).to.equal(25n);
  });
});

describe('maxAmount ceiling', () => {
  // The race this exists to prevent: the user reads the price, the owner
  // raises it, the user's tx lands. Without the ceiling they are silently
  // charged the new price.
  it('reverts rather than overcharging when the price rose after the user read it', async () => {
    const { viem } = await network.create();
    const [, agentWallet, treasury, user] = await viem.getWalletClients();
    const usdc = await viem.deployContract('MockERC20', ['USD Coin', 'USDC', 6]);
    const payment = await deployPayment(viem, agentWallet.account.address, treasury.account.address);
    await payment.write.setAllowedToken([usdc.address, true]);
    await usdc.write.mint([user.account.address, 10_000_000n]);
    await usdc.write.approve([payment.address, 10_000_000n], { account: user.account });

    // User read $0.10 and consented to exactly that.
    const consented = await payment.read.requiredAmount([usdc.address]);
    // Owner raises the price before the user's tx lands.
    await payment.write.setPrice([100n]);

    await expectRevert(
      payment.write.payForThread([usdc.address, 0, consented], { account: user.account }),
      /PRICE_EXCEEDS_MAX/
    );

    // And the user was not charged.
    expect(await usdc.read.balanceOf([user.account.address])).to.equal(10_000_000n);
  });

  it('accepts a maxAmount at or above the price', async () => {
    const { viem } = await network.create();
    const [, agentWallet, treasury, user] = await viem.getWalletClients();
    const usdc = await viem.deployContract('MockERC20', ['USD Coin', 'USDC', 6]);
    const payment = await deployPayment(viem, agentWallet.account.address, treasury.account.address);
    await payment.write.setAllowedToken([usdc.address, true]);
    await usdc.write.mint([user.account.address, 10_000_000n]);
    await usdc.write.approve([payment.address, 10_000_000n], { account: user.account });

    await payment.write.payForThread([usdc.address, 0, 100_000n], { account: user.account });

    expect(await usdc.read.balanceOf([user.account.address])).to.equal(9_900_000n);
  });

  it('splits 50/40/10 exactly at the new price, dust to reserve', async () => {
    const { viem } = await network.create();
    const [, agentWallet, treasury, user] = await viem.getWalletClients();
    const usdc = await viem.deployContract('MockERC20', ['USD Coin', 'USDC', 6]);
    const payment = await deployPayment(viem, agentWallet.account.address, treasury.account.address);
    await payment.write.setAllowedToken([usdc.address, true]);
    await usdc.write.mint([user.account.address, 10_000_000n]);
    await usdc.write.approve([payment.address, 10_000_000n], { account: user.account });

    await payment.write.payForThread([usdc.address, 0, 100_000n], { account: user.account });

    expect(await usdc.read.balanceOf([agentWallet.account.address])).to.equal(50_000n);
    expect(await usdc.read.balanceOf([treasury.account.address])).to.equal(40_000n);
    expect(await usdc.read.balanceOf([payment.address])).to.equal(10_000n);
  });
});

import { describe, it } from 'node:test';
import { expect } from 'chai';
import { network } from 'hardhat';

const ZERO = '0x0000000000000000000000000000000000000000';

// Deploy helper: constructor is (agentWallet, treasury, startThreadId). Reserve
// is retained in-contract, so there is no reservePool address any more.
async function deployPayment(viem: any, agent: string, treasury: string, startThreadId = 0n) {
  return viem.deployContract('ShipPostPayment', [agent, treasury, startThreadId]);
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
    await cusd.write.approve([payment.address, 5n * 10n ** 16n], { account: user.account });

    const id = await payment.simulate.payForThread([cusd.address, 0], { account: user.account });
    expect(id.result).to.equal(100001n);
    await payment.write.payForThread([cusd.address, 0], { account: user.account });
    expect(await payment.read.threadCounter()).to.equal(100001n);
  });

  it('accepts 0.05 cUSD, splits 50/40, and retains the 10% reserve in-contract', async () => {
    const { viem } = await network.create();
    const [, agentWallet, treasury, user] = await viem.getWalletClients();

    const cusd = await viem.deployContract('MockERC20', ['Celo Dollar', 'cUSD', 18]);
    const payment = await deployPayment(viem, agentWallet.account.address, treasury.account.address);
    await payment.write.setAllowedToken([cusd.address, true]);

    await cusd.write.mint([user.account.address, 10n ** 18n]);
    const fiveCent = 5n * 10n ** 16n;
    await cusd.write.approve([payment.address, fiveCent], { account: user.account });
    await payment.write.payForThread([cusd.address, 0], { account: user.account });

    // 0.025 agent / 0.020 treasury / 0.005 reserve held by the contract itself
    expect(await cusd.read.balanceOf([agentWallet.account.address])).to.equal(25n * 10n ** 15n);
    expect(await cusd.read.balanceOf([treasury.account.address])).to.equal(20n * 10n ** 15n);
    expect(await cusd.read.balanceOf([payment.address])).to.equal(5n * 10n ** 15n);
    expect(await payment.read.threadCounter()).to.equal(1n);
  });

  it('accepts 0.05 USDT (6 decimals) with the reserve retained', async () => {
    const { viem } = await network.create();
    const [, agentWallet, treasury, user] = await viem.getWalletClients();

    const usdt = await viem.deployContract('MockERC20', ['Tether USD', 'USDT', 6]);
    const payment = await deployPayment(viem, agentWallet.account.address, treasury.account.address);
    await payment.write.setAllowedToken([usdt.address, true]);

    await usdt.write.mint([user.account.address, 1_000_000n]);
    await usdt.write.approve([payment.address, 50_000n], { account: user.account });
    await payment.write.payForThread([usdt.address, 0], { account: user.account });

    expect(await usdt.read.balanceOf([agentWallet.account.address])).to.equal(25_000n);
    expect(await usdt.read.balanceOf([treasury.account.address])).to.equal(20_000n);
    expect(await usdt.read.balanceOf([payment.address])).to.equal(5_000n);
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
      await payment.write.payForThread([rando.address, 0], { account: user.account });
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
    await cusd.write.approve([payment.address, 5n * 10n ** 16n], { account: user.account });

    const hash = await payment.write.payForThread([cusd.address, 2], { account: user.account });
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
    expect(log.args.amount).to.equal(5n * 10n ** 16n);
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
    await cusd.write.approve([payment.address, 5n * 10n ** 16n], { account: user.account });
    await payment.write.payForThread([cusd.address, 0], { account: user.account });

    expect(await cusd.read.balanceOf([newAgent.account.address])).to.equal(25n * 10n ** 15n);
    expect(await cusd.read.balanceOf([newTreasury.account.address])).to.equal(20n * 10n ** 15n);
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
    await cusd.write.approve([payment.address, 5n * 10n ** 16n], { account: user.account });

    await payment.write.pause();

    let reverted = false;
    try {
      await payment.write.payForThread([cusd.address, 0], { account: user.account });
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
    await usdt.write.approve([payment.address, 50_000n], { account: user.account });
    await payment.write.payForThread([usdt.address, 1], { account: user.account });

    expect(await usdt.read.balanceOf([agentWallet.account.address])).to.equal(25_000n);
    expect(await usdt.read.balanceOf([treasury.account.address])).to.equal(20_000n);
    expect(await usdt.read.balanceOf([payment.address])).to.equal(5_000n);
  });

  // --- refund (reserve-funded) ---

  // Pay `count` threads so the contract holds `count * reserveShare` of reserve.
  async function seedReserve(viem: any, payment: any, cusd: any, user: any, count: number) {
    const fiveCent = 5n * 10n ** 16n;
    await cusd.write.mint([user.account.address, fiveCent * BigInt(count)]);
    for (let i = 0; i < count; i++) {
      await cusd.write.approve([payment.address, fiveCent], { account: user.account });
      await payment.write.payForThread([cusd.address, 0], { account: user.account });
    }
  }

  it('refunds a thread from the reserve and marks it refunded', async () => {
    const { viem } = await network.create();
    const [, agentWallet, treasury, user] = await viem.getWalletClients();

    const cusd = await viem.deployContract('MockERC20', ['Celo Dollar', 'cUSD', 18]);
    const payment = await deployPayment(viem, agentWallet.account.address, treasury.account.address);
    await payment.write.setAllowedToken([cusd.address, true]);
    // 10 threads => reserve = 10 * 0.005 = 0.05 cUSD, exactly one full refund.
    await seedReserve(viem, payment, cusd, user, 10);

    const fiveCent = 5n * 10n ** 16n;
    const before = await cusd.read.balanceOf([user.account.address]);
    await payment.write.refund([1n, cusd.address, user.account.address, fiveCent]);

    expect(await cusd.read.balanceOf([user.account.address])).to.equal(before + fiveCent);
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
    await seedReserve(viem, payment, cusd, user, 1); // reserve = 0.005 cUSD

    let reverted = false;
    try {
      await payment.write.refund([1n, cusd.address, user.account.address, 5n * 10n ** 16n]);
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
    await seedReserve(viem, payment, cusd, user, 4); // reserve = 0.020 cUSD

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

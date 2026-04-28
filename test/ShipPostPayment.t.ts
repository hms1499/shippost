import { describe, it } from 'node:test';
import { expect } from 'chai';
import { network } from 'hardhat';

describe('ShipPostPayment', () => {
  it('deploys with correct initial state', async () => {
    const { viem } = await network.create();
    const [deployer, agentWallet, treasury, reservePool] = await viem.getWalletClients();

    const payment = await viem.deployContract('ShipPostPayment', [
      agentWallet.account.address,
      treasury.account.address,
      reservePool.account.address,
    ]);

    expect((await payment.read.agentWallet()).toLowerCase()).to.equal(
      agentWallet.account.address.toLowerCase()
    );
    expect((await payment.read.treasury()).toLowerCase()).to.equal(
      treasury.account.address.toLowerCase()
    );
    expect((await payment.read.reservePool()).toLowerCase()).to.equal(
      reservePool.account.address.toLowerCase()
    );
    expect(await payment.read.threadCounter()).to.equal(0n);
  });

  it('accepts 0.05 cUSD and splits 50/40/10', async () => {
    const { viem } = await network.create();
    const [deployer, agentWallet, treasury, reservePool, user] = await viem.getWalletClients();

    const cusd = await viem.deployContract('MockERC20', ['Celo Dollar', 'cUSD', 18]);
    const payment = await viem.deployContract('ShipPostPayment', [
      agentWallet.account.address,
      treasury.account.address,
      reservePool.account.address,
    ]);

    await payment.write.setAllowedToken([cusd.address, true]);

    // Mint 1 cUSD to user
    const oneCusd = 10n ** 18n;
    await cusd.write.mint([user.account.address, oneCusd]);

    // User approves payment contract
    const fiveCent = 5n * 10n ** 16n; // 0.05 * 10^18
    await cusd.write.approve([payment.address, fiveCent], { account: user.account });

    await payment.write.payForThread([cusd.address, 0], { account: user.account });

    // Expected splits: 0.025 / 0.020 / 0.005 cUSD
    expect(await cusd.read.balanceOf([agentWallet.account.address])).to.equal(25n * 10n ** 15n);
    expect(await cusd.read.balanceOf([treasury.account.address])).to.equal(20n * 10n ** 15n);
    expect(await cusd.read.balanceOf([reservePool.account.address])).to.equal(5n * 10n ** 15n);
    expect(await payment.read.threadCounter()).to.equal(1n);
  });

  it('accepts 0.05 USDT (6 decimals) with correct scaled amount', async () => {
    const { viem } = await network.create();
    const [deployer, agentWallet, treasury, reservePool, user] = await viem.getWalletClients();

    const usdt = await viem.deployContract('MockERC20', ['Tether USD', 'USDT', 6]);
    const payment = await viem.deployContract('ShipPostPayment', [
      agentWallet.account.address,
      treasury.account.address,
      reservePool.account.address,
    ]);

    await payment.write.setAllowedToken([usdt.address, true]);

    // Mint 1 USDT (1_000_000 smallest units) to user
    await usdt.write.mint([user.account.address, 1_000_000n]);

    // 0.05 USDT = 50_000 smallest units
    const fiveCent = 50_000n;
    await usdt.write.approve([payment.address, fiveCent], { account: user.account });

    expect(await payment.read.requiredAmount([usdt.address])).to.equal(fiveCent);

    await payment.write.payForThread([usdt.address, 1], { account: user.account });

    // 50/40/10 split of 50_000: 25_000 / 20_000 / 5_000
    expect(await usdt.read.balanceOf([agentWallet.account.address])).to.equal(25_000n);
    expect(await usdt.read.balanceOf([treasury.account.address])).to.equal(20_000n);
    expect(await usdt.read.balanceOf([reservePool.account.address])).to.equal(5_000n);
  });

  it('reverts when token is not whitelisted', async () => {
    const { viem } = await network.create();
    const [deployer, agentWallet, treasury, reservePool, user] = await viem.getWalletClients();

    const rando = await viem.deployContract('MockERC20', ['Random', 'RND', 18]);
    const payment = await viem.deployContract('ShipPostPayment', [
      agentWallet.account.address,
      treasury.account.address,
      reservePool.account.address,
    ]);

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
    const [deployer, agentWallet, treasury, reservePool, user] = await viem.getWalletClients();

    const cusd = await viem.deployContract('MockERC20', ['Celo Dollar', 'cUSD', 18]);
    const payment = await viem.deployContract('ShipPostPayment', [
      agentWallet.account.address,
      treasury.account.address,
      reservePool.account.address,
    ]);
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

  it('blocks payForThread when paused', async () => {
    const { viem } = await network.create();
    const [deployer, agentWallet, treasury, reservePool, user] = await viem.getWalletClients();

    const cusd = await viem.deployContract('MockERC20', ['Celo Dollar', 'cUSD', 18]);
    const payment = await viem.deployContract('ShipPostPayment', [
      agentWallet.account.address,
      treasury.account.address,
      reservePool.account.address,
    ]);
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
});

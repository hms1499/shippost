import { describe, it } from 'node:test';
import { expect } from 'chai';
import { network } from 'hardhat';

describe('AgentWallet', () => {
  it('deploys with owner and zero caps', async () => {
    const { viem } = await network.create();
    const [owner] = await viem.getWalletClients();

    const wallet = await viem.deployContract('AgentWallet', []);

    expect((await wallet.read.owner()).toLowerCase()).to.equal(owner.account.address.toLowerCase());
  });

  it('transfers tokens and emits event when within cap', async () => {
    const { viem } = await network.create();
    const publicClient = await viem.getPublicClient();
    const [owner, service] = await viem.getWalletClients();

    const cusd = await viem.deployContract('MockERC20', ['Celo Dollar', 'cUSD', 18]);
    const wallet = await viem.deployContract('AgentWallet', []);

    // Fund wallet + set cap
    await cusd.write.mint([wallet.address, 10n * 10n ** 18n]);
    await wallet.write.setDailySpendCap([cusd.address, 5n * 10n ** 18n]); // $5 cap

    const amt = 1n * 10n ** 16n; // 0.01 cUSD
    const hash = await wallet.write.executeX402Call([
      service.account.address,
      cusd.address,
      amt,
      42n,
    ]);
    await publicClient.waitForTransactionReceipt({ hash });

    expect(await cusd.read.balanceOf([service.account.address])).to.equal(amt);

    const logs = await publicClient.getContractEvents({
      address: wallet.address,
      abi: wallet.abi,
      eventName: 'X402PaymentMade',
    });
    expect(logs.length).to.equal(1);
    expect((logs[0] as any).args.threadId).to.equal(42n);
  });

  it('reverts when cap exceeded', async () => {
    const { viem } = await network.create();
    const [owner, service] = await viem.getWalletClients();

    const cusd = await viem.deployContract('MockERC20', ['Celo Dollar', 'cUSD', 18]);
    const wallet = await viem.deployContract('AgentWallet', []);
    await cusd.write.mint([wallet.address, 10n * 10n ** 18n]);
    await wallet.write.setDailySpendCap([cusd.address, 1n * 10n ** 16n]); // $0.01 cap

    // First call uses full cap
    await wallet.write.executeX402Call([service.account.address, cusd.address, 1n * 10n ** 16n, 1n]);

    // Second call any amount should revert
    let reverted = false;
    try {
      await wallet.write.executeX402Call([service.account.address, cusd.address, 1n, 2n]);
    } catch (e: any) {
      reverted = /CAP_EXCEEDED/.test(e.message);
    }
    expect(reverted).to.equal(true);
  });

  it('reverts when called by non-owner', async () => {
    const { viem } = await network.create();
    const [owner, service, attacker] = await viem.getWalletClients();

    const cusd = await viem.deployContract('MockERC20', ['Celo Dollar', 'cUSD', 18]);
    const wallet = await viem.deployContract('AgentWallet', []);
    await cusd.write.mint([wallet.address, 10n ** 18n]);
    await wallet.write.setDailySpendCap([cusd.address, 10n ** 18n]);

    let reverted = false;
    try {
      await wallet.write.executeX402Call(
        [service.account.address, cusd.address, 1n, 1n],
        { account: attacker.account }
      );
    } catch (e: any) {
      reverted = /OwnableUnauthorizedAccount|Ownable/.test(e.message);
    }
    expect(reverted).to.equal(true);
  });

  it('blocks executeX402Call while paused, allows emergencyWithdraw', async () => {
    const { viem } = await network.create();
    const [owner, service] = await viem.getWalletClients();

    const cusd = await viem.deployContract('MockERC20', ['Celo Dollar', 'cUSD', 18]);
    const wallet = await viem.deployContract('AgentWallet', []);
    await cusd.write.mint([wallet.address, 10n * 10n ** 18n]);
    await wallet.write.setDailySpendCap([cusd.address, 5n * 10n ** 18n]);

    await wallet.write.pause();

    let blocked = false;
    try {
      await wallet.write.executeX402Call([
        service.account.address,
        cusd.address,
        1n * 10n ** 16n,
        1n,
      ]);
    } catch (e: any) {
      blocked = /EnforcedPause/.test(e.message);
    }
    expect(blocked).to.equal(true);

    // emergencyWithdraw must still work while paused.
    await wallet.write.emergencyWithdraw([
      cusd.address,
      10n * 10n ** 18n,
      owner.account.address,
    ]);
    expect(await cusd.read.balanceOf([owner.account.address])).to.equal(10n * 10n ** 18n);
  });

  it('only owner can pause/unpause', async () => {
    const { viem } = await network.create();
    const [, , attacker] = await viem.getWalletClients();
    const wallet = await viem.deployContract('AgentWallet', []);

    let reverted = false;
    try {
      await wallet.write.pause([], { account: attacker.account });
    } catch (e: any) {
      reverted = /OwnableUnauthorizedAccount|Ownable/.test(e.message);
    }
    expect(reverted).to.equal(true);

    await wallet.write.pause();
    await wallet.write.unpause();
  });

  it('resets daily allowance after day rollover', async () => {
    const { viem } = await network.create();
    const publicClient = await viem.getPublicClient();
    const testClient = await viem.getTestClient();
    const [, service] = await viem.getWalletClients();

    const cusd = await viem.deployContract('MockERC20', ['Celo Dollar', 'cUSD', 18]);
    const wallet = await viem.deployContract('AgentWallet', []);
    await cusd.write.mint([wallet.address, 10n * 10n ** 18n]);
    await wallet.write.setDailySpendCap([cusd.address, 1n * 10n ** 16n]);

    await wallet.write.executeX402Call([service.account.address, cusd.address, 1n * 10n ** 16n, 1n]);

    let capped = false;
    try {
      await wallet.write.executeX402Call([service.account.address, cusd.address, 1n, 2n]);
    } catch (e: any) {
      capped = /CAP_EXCEEDED/.test(e.message);
    }
    expect(capped).to.equal(true);

    // Advance >24h; allowance should reset.
    await testClient.increaseTime({ seconds: 86_500 });
    await testClient.mine({ blocks: 1 });

    const hash = await wallet.write.executeX402Call([
      service.account.address,
      cusd.address,
      1n * 10n ** 16n,
      3n,
    ]);
    await publicClient.waitForTransactionReceipt({ hash });
    expect(await cusd.read.balanceOf([service.account.address])).to.equal(2n * 10n ** 16n);
  });
});

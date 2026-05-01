/**
 * Mint mock cUSD/USDT/USDC to any address on Celo Sepolia for testing.
 * Usage: npx hardhat run scripts/mint-testnet-tokens.ts --network celoSepolia
 *        RECIPIENT=0xYourAddress npx hardhat run scripts/mint-testnet-tokens.ts --network celoSepolia
 */
import { network } from 'hardhat';

const DEPLOYMENTS = {
  MockCUSD: '0xde53066fc77565f7258d5d59ccf129a2ba43a3be',
  MockUSDT: '0x174caa3b72fc683de0d62474ed1e24e36a6ab311',
  MockUSDC: '0xfe26e6efa3189cf0eb7b5014b94137493def9107',
};

const MINT_AMOUNTS = {
  MockCUSD: 10n * 10n ** 18n,   // 10 cUSD
  MockUSDT: 10n * 10n ** 6n,    // 10 USDT
  MockUSDC: 10n * 10n ** 6n,    // 10 USDC
};

async function main() {
  const { viem } = await network.create();
  const [deployer] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();

  const recipient = (process.env.RECIPIENT ?? deployer.account.address) as `0x${string}`;
  console.log(`Minting to: ${recipient}`);

  const mintAbi = [
    {
      inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
      name: 'mint',
      outputs: [],
      stateMutability: 'nonpayable',
      type: 'function',
    },
  ] as const;

  for (const [name, address] of Object.entries(DEPLOYMENTS) as [keyof typeof DEPLOYMENTS, `0x${string}`][]) {
    const amount = MINT_AMOUNTS[name];
    const hash = await deployer.writeContract({
      address,
      abi: mintAbi,
      functionName: 'mint',
      args: [recipient, amount],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`✓ Minted ${name}: ${amount / 10n ** (name === 'MockCUSD' ? 18n : 6n)} tokens — tx: ${hash}`);
  }

  console.log('\nDone! Check balances on:');
  console.log(`https://celo-sepolia.blockscout.com/address/${recipient}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Mint mock cUSD/USDT/USDC to any address on Celo Sepolia for testing.
 * Usage: npx hardhat run scripts/mint-testnet-tokens.ts --network celoSepolia
 *        RECIPIENT=0xYourAddress npx hardhat run scripts/mint-testnet-tokens.ts --network celoSepolia
 */
import { network } from 'hardhat';

const DEPLOYMENTS = {
  MockCUSD: '0xb7e155e9d4ab5a97f950c3259dace91b0f6c33f5',
  MockUSDT: '0xd589cc6f20103401c1e168b9d2b3075e8b5fabca',
  MockUSDC: '0x6bba6a2326fd6ab4694de5c9369001d7a3720dc1',
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

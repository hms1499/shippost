/**
 * ERC-8004 Agent Identity Registration for ShipPost
 *
 * Registers the ShipPost AI agent with the on-chain Identity Registry
 * and links the AgentWallet address to the resulting agentId.
 *
 * Usage:
 *   npx hardhat run scripts/register-erc8004.ts --network celoSepolia
 *   npx hardhat run scripts/register-erc8004.ts --network celo
 */
import { network } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { decodeEventLog } from 'viem';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ERC-8004 Identity Registry addresses keyed by chainId
const IDENTITY_REGISTRY: Record<number, `0x${string}`> = {
  42220:    '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432', // Celo Mainnet
  11142220: '0x8004A818BFB912233c491871b3d84c89A494BD9e', // Celo Sepolia
};

const NETWORK_NAME: Record<number, string> = {
  42220:    'celo',
  11142220: 'celoSepolia',
};

// Minimal ABI — only what this script needs
const REGISTRY_ABI = [
  {
    name: 'register',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'agentURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
  },
  {
    name: 'setAgentWallet',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId',   type: 'uint256' },
      { name: 'newWallet', type: 'address' },
      { name: 'deadline',  type: 'uint256' },
      { name: 'signature', type: 'bytes'   },
    ],
    outputs: [],
  },
  {
    name: 'eip712Domain',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'fields',           type: 'bytes1'    },
      { name: 'name',             type: 'string'    },
      { name: 'version',          type: 'string'    },
      { name: 'chainId',          type: 'uint256'   },
      { name: 'verifyingContract', type: 'address'  },
      { name: 'salt',             type: 'bytes32'   },
      { name: 'extensions',       type: 'uint256[]' },
    ],
  },
  {
    name: 'walletSetNonces',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'Transfer',
    type: 'event',
    inputs: [
      { name: 'from',    type: 'address', indexed: true  },
      { name: 'to',      type: 'address', indexed: true  },
      { name: 'tokenId', type: 'uint256', indexed: true  },
    ],
  },
] as const;

async function main() {
  const { viem } = await network.create();
  const [deployer] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();

  const chainId: number = await publicClient.getChainId();
  const networkName = NETWORK_NAME[chainId] ?? `chain-${chainId}`;
  const registryAddress = IDENTITY_REGISTRY[chainId];
  if (!registryAddress) {
    throw new Error(`No registry address for chainId ${chainId}. Use --network celo or --network celoSepolia`);
  }

  console.log(`\nNetwork:   ${networkName} (${chainId})`);
  console.log(`Registry:  ${registryAddress}`);
  console.log(`Deployer:  ${deployer.account.address}`);

  // ─── Step 1: Register agent (skip if AGENT_ID env var is set) ───────────
  const agentURI = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/agent.json`
    : 'https://shippost.vercel.app/agent.json';

  let agentId: bigint;
  let registerTx: string | undefined;

  if (process.env.ERC8004_AGENT_ID) {
    agentId = BigInt(process.env.ERC8004_AGENT_ID);
    console.log(`\n[1/3] Skipping register — using existing agentId: ${agentId}`);
  } else {
    console.log(`\n[1/3] Registering agent with URI: ${agentURI}`);

    const registerHash = await publicClient.waitForTransactionReceipt({
      hash: await deployer.writeContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: 'register',
        args: [agentURI],
      }),
    });

    registerTx = registerHash.transactionHash;

    // Extract agentId from the ERC-721 Transfer event (from=0x0 = mint)
    agentId = 0n;
    for (const log of registerHash.logs) {
      try {
        const decoded = decodeEventLog({
          abi: REGISTRY_ABI,
          eventName: 'Transfer',
          data: log.data,
          topics: log.topics,
        });
        if (decoded.args.from === '0x0000000000000000000000000000000000000000') {
          agentId = decoded.args.tokenId;
          break;
        }
      } catch {
        // skip logs that don't match
      }
    }

    if (agentId === 0n) {
      throw new Error('Could not extract agentId from Transfer event. Check tx: ' + registerHash.transactionHash);
    }

    console.log(`    agentId: ${agentId}`);
    console.log(`    tx:      ${registerHash.transactionHash}`);
  }

  // ─── Step 2: Sign EIP-712 message for setAgentWallet ─────────────────────
  // The signature must come from newWallet (we use deployer EOA as the agent wallet)
  console.log('\n[2/3] Signing EIP-712 AgentWalletSet message...');

  // Domain confirmed from contract source: __EIP712_init("SelfAgentRegistry", "1")
  const domainName = 'SelfAgentRegistry';
  const domainVersion = '1';
  const domainChainId = chainId;
  const verifyingContract = registryAddress;

  // Read nonce (first successful setAgentWallet = nonce 0)
  let nonce = 0n;
  try {
    nonce = await publicClient.readContract({
      address: registryAddress,
      abi: REGISTRY_ABI,
      functionName: 'walletSetNonces',
      args: [agentId],
    });
  } catch {
    // deployed bytecode may differ from GitHub — nonce 0 is safe for first call
  }
  console.log(`    nonce: ${nonce}`);

  // Contract enforces deadline <= block.timestamp + 300s ("deadline too far" if exceeded)
  const latestBlock = await publicClient.getBlock({ blockTag: 'latest' });
  const deadline = latestBlock.timestamp + 280n; // 280s < 300s max window
  const newWallet = deployer.account.address; // deployer EOA controls the agent

  const signature = await deployer.signTypedData({
    domain: {
      name: domainName,
      version: domainVersion,
      chainId: domainChainId,
      verifyingContract,
    },
    types: {
      AgentWalletSet: [
        { name: 'agentId',   type: 'uint256' },
        { name: 'newWallet', type: 'address' },
        { name: 'owner',     type: 'address' },
        { name: 'nonce',     type: 'uint256' },
        { name: 'deadline',  type: 'uint256' },
      ],
    },
    primaryType: 'AgentWalletSet',
    message: {
      agentId,
      newWallet,
      owner: deployer.account.address,
      nonce,
      deadline,
    },
  });

  console.log(`    newWallet: ${newWallet}`);
  console.log(`    deadline:  ${deadline} (unix)`);

  // ─── Step 3: Link wallet to agentId ──────────────────────────────────────
  console.log('\n[3/3] Calling setAgentWallet...');

  const walletHash = await publicClient.waitForTransactionReceipt({
    hash: await deployer.writeContract({
      address: registryAddress,
      abi: REGISTRY_ABI,
      functionName: 'setAgentWallet',
      args: [agentId, newWallet, deadline, signature as `0x${string}`],
    }),
  });

  console.log(`    tx: ${walletHash.transactionHash}`);

  // ─── Summary ──────────────────────────────────────────────────────────────
  const result = {
    network: networkName,
    chainId: domainChainId,
    registry: registryAddress,
    agentId: agentId.toString(),
    agentURI,
    agentWallet: newWallet,
    registerTx: registerTx ?? '(skipped)',
    setWalletTx: walletHash.transactionHash,
    timestamp: new Date().toISOString(),
  };

  const outPath = path.join(__dirname, '..', 'deployments', `erc8004-${networkName}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

  console.log('\n✓ ERC-8004 registration complete');
  console.log(JSON.stringify(result, null, 2));
  console.log(`\nSaved to: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

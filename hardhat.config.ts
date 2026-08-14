import { defineConfig } from 'hardhat/config';
import hardhatToolboxViem from '@nomicfoundation/hardhat-toolbox-viem';
import hardhatVerify from '@nomicfoundation/hardhat-verify';
import * as dotenv from 'dotenv';

dotenv.config();

function requireDeployerPk(): string {
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk) return '0x' + '0'.repeat(64);
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error('DEPLOYER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex string');
  }
  return pk;
}

const DEPLOYER_PK = requireDeployerPk();
// forno.celo.org is rate-limited and intermittently returns non-standard HTTP
// statuses that break tx submission. Override with a more reliable endpoint
// (e.g. CELO_RPC_URL=https://celo.drpc.org) without touching code.
const CELO_RPC_URL = process.env.CELO_RPC_URL || 'https://forno.celo.org';
const FORK_URL = process.env.CELO_FORK_URL || 'https://forno.celo.org';
const FORK_BLOCK = process.env.CELO_FORK_BLOCK ? parseInt(process.env.CELO_FORK_BLOCK) : undefined;

export default defineConfig({
  plugins: [hardhatToolboxViem, hardhatVerify],
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  // Verify on Celo's Blockscout (keyless). HH3 has no built-in descriptor for
  // Celo mainnet, so we supply the explorer endpoint here.
  chainDescriptors: {
    42220: {
      name: 'Celo',
      blockExplorers: {
        blockscout: {
          name: 'Celo Blockscout',
          url: 'https://celo.blockscout.com',
          apiUrl: 'https://celo.blockscout.com/api',
        },
      },
    },
  },
  // Base verifies on Basescan (Etherscan), Celo on Blockscout. Both are enabled
  // so Hardhat can pick the right one per chain; Blockscout is keyless, Etherscan
  // needs BASESCAN_API_KEY (an Etherscan V2 key covers Base).
  verify: {
    blockscout: { enabled: true },
    etherscan: { enabled: true, apiKey: process.env.BASESCAN_API_KEY || '' },
    sourcify: { enabled: false },
  },
  paths: {
    sources: './contracts',
    tests: './test/contracts',
    cache: './cache',
    artifacts: './artifacts',
  },
  networks: {
    hardhat: {
      type: 'edr-simulated',
      chainId: 31337,
      // Mainnet fork — used by decimal tests (Task 10-11) to test against real token contracts.
      // Set CELO_FORK=true in .env to activate; leave unset for fast local tests.
      ...(process.env.CELO_FORK === 'true' && {
        forking: {
          enabled: true,
          url: FORK_URL,
          ...(FORK_BLOCK && { blockNumber: FORK_BLOCK }),
        },
      }),
    } as any,
    celoSepolia: {
      type: 'http',
      url: 'https://forno.celo-sepolia.celo-testnet.org',
      accounts: [DEPLOYER_PK],
      chainId: 11142220,
    },
    celo: {
      type: 'http',
      url: CELO_RPC_URL,
      accounts: [DEPLOYER_PK],
      chainId: 42220,
    },
    base: {
      type: 'http',
      url: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
      accounts: [DEPLOYER_PK],
      chainId: 8453,
    },
    baseSepolia: {
      type: 'http',
      url: process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
      accounts: [DEPLOYER_PK],
      chainId: 84532,
    },
  },
});

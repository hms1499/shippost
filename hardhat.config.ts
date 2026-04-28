import { defineConfig } from 'hardhat/config';
import hardhatToolboxViem from '@nomicfoundation/hardhat-toolbox-viem';
import * as dotenv from 'dotenv';

dotenv.config();

const DEPLOYER_PK = process.env.DEPLOYER_PRIVATE_KEY || '0x' + '0'.repeat(64);
const FORK_URL = process.env.CELO_FORK_URL || 'https://forno.celo.org';
const FORK_BLOCK = process.env.CELO_FORK_BLOCK ? parseInt(process.env.CELO_FORK_BLOCK) : undefined;

export default defineConfig({
  plugins: [hardhatToolboxViem],
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  paths: {
    sources: './contracts',
    tests: './test',
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
    alfajores: {
      type: 'http',
      url: 'https://alfajores-forno.celo-testnet.org',
      accounts: [DEPLOYER_PK],
      chainId: 44787,
    },
    celoSepolia: {
      type: 'http',
      url: 'https://forno.celo-sepolia.celo-testnet.org',
      accounts: [DEPLOYER_PK],
      chainId: 11142220,
    },
    celo: {
      type: 'http',
      url: 'https://forno.celo.org',
      accounts: [DEPLOYER_PK],
      chainId: 42220,
    },
  },
});

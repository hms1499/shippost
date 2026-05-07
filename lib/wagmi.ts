import { http } from 'wagmi';
import { celo } from 'wagmi/chains';
import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { celoSepolia } from './celoSepolia';

export { celoSepolia };

// RainbowKit's getDefaultConfig requires a non-empty projectId at module load.
// Falling back to a placeholder lets builds succeed without WC configured;
// at runtime the WalletConnect option will fail to init but injected/Coinbase
// wallets still work, which covers MiniPay (the priority surface).
const projectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'shippost-placeholder';

export const wagmiConfig = getDefaultConfig({
  appName: 'ShipPost',
  projectId,
  chains: [celo, celoSepolia],
  transports: {
    [celo.id]: http('https://forno.celo.org'),
    [celoSepolia.id]: http('https://forno.celo-sepolia.celo-testnet.org'),
  },
  ssr: true,
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}

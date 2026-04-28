# ShipPost Week 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundational infrastructure for ShipPost — deployed smart contracts on Alfajores testnet, working MiniPay detection, x402 proxy POC with Groq, and a basic UI that proves the end-to-end pay → agent → x402 → output loop.

**Architecture:** Next.js 14 monorepo (App Router) with co-located Solidity contracts (Hardhat). Frontend uses wagmi + viem + Tailwind + shadcn/ui. Contracts are `ShipPostPayment` (payment splitter) + `AgentWallet` (ERC-8004-compatible, holds stablecoins for x402). Backend x402 proxy lives in Next.js API routes, verifies EIP-712 payment signatures, forwards to Groq API using our free-tier key, then settles on-chain.

**Tech Stack:** Next.js 14, TypeScript, viem, wagmi, Tailwind, shadcn/ui, Solidity 0.8.24, Hardhat, OpenZeppelin, Supabase (free tier, added Task 24), Vercel.

**Spec reference:** `/Users/vanhuy/shippost/docs/superpowers/specs/2026-04-24-shippost-minipay-design.md`

**Week 1 Gate (end of plan):** 30-second screencast on Alfajores testnet showing: open app → connect (auto in MiniPay) → select mode → pay 0.05 mock-cUSD → agent wallet makes x402 call to Groq via proxy → mock thread output displayed. All transactions visible on Alfajores block explorer.

---

## File Structure

Files to create in Week 1:

```
shippost/
├── .env.example                        # Template for env vars
├── .gitignore                          # node_modules, .env, artifacts
├── README.md                           # Project overview
├── package.json                        # Next.js deps + scripts
├── tsconfig.json                       # TS config
├── next.config.js                      # Next.js config
├── tailwind.config.ts                  # Tailwind + shadcn theme
├── postcss.config.js                   # Tailwind PostCSS
├── components.json                     # shadcn CLI config
├── hardhat.config.ts                   # Celo + Alfajores networks
│
├── contracts/
│   ├── ShipPostPayment.sol             # Payment splitter
│   ├── AgentWallet.sol                 # ERC-8004 compatible wallet
│   └── mocks/
│       └── MockERC20.sol               # Mock cUSD/USDT/USDC for tests
│
├── test/
│   ├── ShipPostPayment.t.ts            # Hardhat tests
│   └── AgentWallet.t.ts                # Hardhat tests
│
├── scripts/
│   └── deploy.ts                       # Deploy to Alfajores
│
├── app/
│   ├── layout.tsx                      # Root layout with providers
│   ├── page.tsx                        # Landing / main app
│   ├── providers.tsx                   # wagmi + react-query
│   ├── globals.css                     # Tailwind + shadcn CSS vars
│   └── api/
│       └── x402/
│           └── groq/
│               └── route.ts            # x402 proxy for Groq
│
├── components/
│   ├── ui/                             # shadcn components (button, card, etc)
│   ├── ModePicker.tsx                  # Two-card mode selection
│   ├── EducationalInput.tsx            # Topic + audience + length form
│   ├── TokenSelector.tsx               # cUSD/USDT/USDC dropdown
│   ├── WalletStatus.tsx                # Address + balances header
│   └── GeneratingStatus.tsx            # Mock progress theatre
│
└── lib/
    ├── wagmi.ts                        # Celo chain config + connectors
    ├── minipay.ts                      # isMiniPay detection
    ├── tokens.ts                       # Token addresses + decimals
    ├── contracts.ts                    # Contract addresses + ABIs
    ├── useBalances.ts                  # Balance fetcher hook
    └── usePayForThread.ts              # Payment tx hook
```

Responsibility summary:
- `contracts/*.sol` — on-chain logic (payment split, agent spending caps)
- `app/api/x402/*` — off-chain proxy that accepts signed payment intents and calls real APIs
- `app/page.tsx` + `components/*` — the UI surface
- `lib/*` — shared hooks and config

---

## Prerequisite: Before Task 1

**You must have these ready:**
- Node.js ≥ 20.x installed
- pnpm installed (`npm i -g pnpm`)
- A Celo mainnet wallet with ~$10 cUSD (for future weeks; not needed Week 1)
- An Alfajores testnet wallet with ≥2 CELO (from https://faucet.celo.org/alfajores)
- A free Groq API key (from https://console.groq.com/keys)
- A GitHub account
- A Vercel account connected to GitHub

---

## Task 1: Initialize project repo

**Files:**
- Create: `/Users/vanhuy/shippost/.gitignore`
- Create: `/Users/vanhuy/shippost/README.md`
- Create: `/Users/vanhuy/shippost/package.json`

- [ ] **Step 1: Initialize git repo**

```bash
cd /Users/vanhuy/shippost
git init
git branch -M main
```

Expected: `Initialized empty Git repository in /Users/vanhuy/shippost/.git/`

- [ ] **Step 2: Create .gitignore**

```
# Dependencies
node_modules/
.pnpm-store/

# Next.js
.next/
out/
build/

# Hardhat
artifacts/
cache/
coverage/
coverage.json
typechain-types/

# Env
.env
.env.local
.env.*.local

# Editor
.vscode/
.idea/
.DS_Store

# Logs
*.log
npm-debug.log*
pnpm-debug.log*
```

Write this to `/Users/vanhuy/shippost/.gitignore`.

- [ ] **Step 3: Create README.md skeleton**

```markdown
# ShipPost

The pay-per-post AI thread writer for crypto builders. $0.05/thread. No subscription. Powered by MiniPay.

Proof of Ship competition submission — April 2026.

## Status

🚧 Week 1 of 4 — Foundation

## Quick start

```bash
pnpm install
pnpm dev
```

See `docs/superpowers/specs/` for full design doc.
```

Write this to `/Users/vanhuy/shippost/README.md`.

- [ ] **Step 4: Initialize package.json**

```bash
cd /Users/vanhuy/shippost
pnpm init
```

Then edit `package.json` to set:
```json
{
  "name": "shippost",
  "version": "0.0.1",
  "private": true,
  "description": "Pay-per-post AI thread writer for crypto builders — MiniPay MiniApp",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test:contracts": "hardhat test",
    "compile": "hardhat compile",
    "deploy:testnet": "hardhat run scripts/deploy.ts --network alfajores"
  }
}
```

- [ ] **Step 5: First commit**

```bash
git add .gitignore README.md package.json
git commit -m "chore: initialize shippost repo"
```

Expected: commit created with 3 files.

---

## Task 2: Install Next.js + TypeScript core

**Files:**
- Create: `/Users/vanhuy/shippost/tsconfig.json`
- Create: `/Users/vanhuy/shippost/next.config.js`
- Create: `/Users/vanhuy/shippost/app/layout.tsx`
- Create: `/Users/vanhuy/shippost/app/page.tsx`

- [ ] **Step 1: Install Next.js + React**

```bash
cd /Users/vanhuy/shippost
pnpm add next@14 react@18 react-dom@18
pnpm add -D typescript @types/react @types/react-dom @types/node
```

Expected: packages added, `pnpm-lock.yaml` created.

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "artifacts", "cache", "typechain-types"]
}
```

Write to `/Users/vanhuy/shippost/tsconfig.json`.

- [ ] **Step 3: Create next.config.js**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
};

module.exports = nextConfig;
```

Write to `/Users/vanhuy/shippost/next.config.js`.

- [ ] **Step 4: Create minimal app/layout.tsx**

```tsx
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ShipPost',
  description: 'Pay-per-post AI thread writer for crypto builders',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

Write to `/Users/vanhuy/shippost/app/layout.tsx`.

- [ ] **Step 5: Create minimal app/page.tsx**

```tsx
export default function Home() {
  return (
    <main>
      <h1>ShipPost</h1>
      <p>Foundation in progress…</p>
    </main>
  );
}
```

Write to `/Users/vanhuy/shippost/app/page.tsx`.

- [ ] **Step 6: Verify dev server starts**

```bash
cd /Users/vanhuy/shippost
pnpm dev
```

Expected: `▲ Next.js 14.x.x - Local: http://localhost:3000`. Visit it in browser, see "ShipPost / Foundation in progress…". Stop with Ctrl+C.

- [ ] **Step 7: Commit**

```bash
git add tsconfig.json next.config.js app/ package.json pnpm-lock.yaml
git commit -m "feat: install Next.js 14 with TypeScript"
```

---

## Task 3: Install Tailwind + shadcn

**Files:**
- Create: `/Users/vanhuy/shippost/tailwind.config.ts`
- Create: `/Users/vanhuy/shippost/postcss.config.js`
- Create: `/Users/vanhuy/shippost/app/globals.css`
- Create: `/Users/vanhuy/shippost/components.json`
- Modify: `/Users/vanhuy/shippost/app/layout.tsx` (import globals.css)

- [ ] **Step 1: Install Tailwind + PostCSS**

```bash
pnpm add -D tailwindcss@3 postcss autoprefixer
pnpm add clsx tailwind-merge
pnpm add -D @types/node
```

- [ ] **Step 2: Create tailwind.config.ts**

```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [],
};

export default config;
```

- [ ] **Step 3: Create postcss.config.js**

```javascript
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 4: Create app/globals.css with dark-mode default blue theme**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 222 47% 11%;
    --foreground: 210 40% 98%;
    --card: 222 47% 13%;
    --card-foreground: 210 40% 98%;
    --primary: 217 91% 60%;
    --primary-foreground: 222 47% 11%;
    --secondary: 217 33% 17%;
    --secondary-foreground: 210 40% 98%;
    --muted: 217 33% 17%;
    --muted-foreground: 215 20% 65%;
    --accent: 217 33% 17%;
    --accent-foreground: 210 40% 98%;
    --destructive: 0 63% 31%;
    --destructive-foreground: 210 40% 98%;
    --border: 217 33% 22%;
    --input: 217 33% 22%;
    --ring: 217 91% 60%;
    --radius: 0.75rem;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
    font-feature-settings: "rlig" 1, "calt" 1;
  }
}
```

- [ ] **Step 5: Update app/layout.tsx to import globals.css**

Replace the contents of `app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ShipPost',
  description: 'Pay-per-post AI thread writer for crypto builders',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 6: Create components.json for shadcn**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "app/globals.css",
    "baseColor": "slate",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui"
  }
}
```

- [ ] **Step 7: Create lib/utils.ts helper (cn)**

```typescript
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

Write to `/Users/vanhuy/shippost/lib/utils.ts`.

- [ ] **Step 8: Install shadcn Button as sanity check**

```bash
pnpm dlx shadcn@latest add button card
```

Expected: creates `components/ui/button.tsx` and `components/ui/card.tsx`.

- [ ] **Step 9: Update app/page.tsx to use Button (verify styles work)**

```tsx
import { Button } from '@/components/ui/button';

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-4xl font-bold text-primary">ShipPost</h1>
      <p className="text-muted-foreground">Foundation in progress…</p>
      <Button>Sanity check</Button>
    </main>
  );
}
```

- [ ] **Step 10: Verify styling works**

```bash
pnpm dev
```

Visit http://localhost:3000 — should see dark bg, blue "ShipPost" title, muted subtitle, styled button. Stop.

- [ ] **Step 11: Commit**

```bash
git add .
git commit -m "feat: install Tailwind + shadcn with blue dark theme"
```

---

## Task 4: Install wagmi + viem, configure Celo chains

**Files:**
- Create: `/Users/vanhuy/shippost/lib/wagmi.ts`
- Create: `/Users/vanhuy/shippost/app/providers.tsx`
- Modify: `/Users/vanhuy/shippost/app/layout.tsx`

- [ ] **Step 1: Install wagmi, viem, react-query**

```bash
pnpm add wagmi@2 viem@2 @tanstack/react-query@5
```

- [ ] **Step 2: Create lib/wagmi.ts with Celo chains**

```typescript
import { createConfig, http } from 'wagmi';
import { celo, celoAlfajores } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';

export const wagmiConfig = createConfig({
  chains: [celoAlfajores, celo],
  connectors: [
    injected({ shimDisconnect: true }),
  ],
  transports: {
    [celoAlfajores.id]: http('https://alfajores-forno.celo-testnet.org'),
    [celo.id]: http('https://forno.celo.org'),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
```

- [ ] **Step 3: Create app/providers.tsx**

```tsx
'use client';

import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig } from '@/lib/wagmi';

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
```

- [ ] **Step 4: Wrap app/layout.tsx with Providers**

Replace contents of `app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'ShipPost',
  description: 'Pay-per-post AI thread writer for crypto builders',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Test useAccount hook works**

Replace `app/page.tsx`:

```tsx
'use client';

import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { Button } from '@/components/ui/button';

export default function Home() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-4xl font-bold text-primary">ShipPost</h1>
      {isConnected ? (
        <>
          <p className="text-muted-foreground text-sm font-mono">{address}</p>
          <Button onClick={() => disconnect()}>Disconnect</Button>
        </>
      ) : (
        <Button onClick={() => connect({ connector: connectors[0] })}>
          Connect wallet
        </Button>
      )}
    </main>
  );
}
```

- [ ] **Step 6: Verify**

```bash
pnpm dev
```

Visit http://localhost:3000. With MetaMask (or any injected wallet) installed: click "Connect wallet", approve, see address. Stop dev server.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat: configure wagmi + viem with Celo mainnet and Alfajores"
```

---

## Task 5: MiniPay detection + auto-connect

**Files:**
- Create: `/Users/vanhuy/shippost/lib/minipay.ts`
- Modify: `/Users/vanhuy/shippost/lib/wagmi.ts`
- Modify: `/Users/vanhuy/shippost/app/page.tsx`

- [ ] **Step 1: Create lib/minipay.ts**

```typescript
'use client';

import { useEffect, useState } from 'react';

export function detectMiniPay(): boolean {
  if (typeof window === 'undefined') return false;
  const eth = (window as any).ethereum;
  return Boolean(eth?.isMiniPay);
}

export function useIsMiniPay(): boolean {
  const [isMiniPay, setIsMiniPay] = useState(false);

  useEffect(() => {
    setIsMiniPay(detectMiniPay());
  }, []);

  return isMiniPay;
}
```

- [ ] **Step 1b: Deploy to Vercel preview + verify on real MiniPay device (do this before any other task)**

> ⚠️ **RECOMMENDATION — do this first.** MiniPay webview quirks (late provider injection, `eth_requestAccounts` blocking) are the highest-risk unknown. Catching them on Day 1 instead of Day 7 saves the demo.

```bash
# After scaffolding app/page.tsx with just the isMiniPay check below:
vercel --prod=false  # or push to GitHub and let Vercel auto-deploy preview
```

Temporary minimal `app/page.tsx` (replace with real content in Task 18):
```tsx
'use client';
import { useEffect, useState } from 'react';
export default function Page() {
  const [detected, setDetected] = useState<boolean | null>(null);
  useEffect(() => {
    setDetected(Boolean((window as any).ethereum?.isMiniPay));
  }, []);
  return <div style={{ padding: 32, fontSize: 24 }}>
    {detected === null ? 'checking...' : detected ? '✅ MiniPay detected' : '❌ Not MiniPay'}
  </div>;
}
```

Open the Vercel preview URL inside MiniPay on an Android device. **Expected:** `✅ MiniPay detected`. If not, investigate provider injection timing before proceeding.

- [ ] **Step 2: Update app/page.tsx to auto-connect on MiniPay**

Replace `app/page.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { Button } from '@/components/ui/button';
import { useIsMiniPay } from '@/lib/minipay';

export default function Home() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const isMiniPay = useIsMiniPay();

  // Auto-connect when detected in MiniPay webview
  useEffect(() => {
    if (isMiniPay && !isConnected && connectors[0]) {
      connect({ connector: connectors[0] });
    }
  }, [isMiniPay, isConnected, connect, connectors]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-4xl font-bold text-primary">ShipPost</h1>
      {isMiniPay && (
        <span className="text-xs px-2 py-1 rounded-full bg-primary/20 text-primary">
          MiniPay detected
        </span>
      )}
      {isConnected ? (
        <>
          <p className="text-muted-foreground text-sm font-mono">{address}</p>
          {!isMiniPay && (
            <Button variant="outline" onClick={() => disconnect()}>
              Disconnect
            </Button>
          )}
        </>
      ) : (
        <Button onClick={() => connect({ connector: connectors[0] })}>
          Connect wallet
        </Button>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Test auto-connect via browser DevTools**

```bash
pnpm dev
```

In browser console at http://localhost:3000:

```javascript
window.ethereum.isMiniPay = true;
location.reload();
```

Expected: "MiniPay detected" badge appears, auto-connects without button press. Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add lib/minipay.ts app/page.tsx
git commit -m "feat: detect MiniPay and auto-connect wallet"
```

---

## Task 6: Token config + balance hook + WalletStatus component

**Files:**
- Create: `/Users/vanhuy/shippost/lib/tokens.ts`
- Create: `/Users/vanhuy/shippost/lib/useBalances.ts`
- Create: `/Users/vanhuy/shippost/components/WalletStatus.tsx`
- Modify: `/Users/vanhuy/shippost/app/page.tsx`

- [ ] **Step 1: Create lib/tokens.ts**

```typescript
import { celo, celoAlfajores } from 'wagmi/chains';
import type { Address } from 'viem';

export type TokenSymbol = 'cUSD' | 'USDT' | 'USDC';

export interface TokenConfig {
  symbol: TokenSymbol;
  address: Address;
  decimals: number;
  displayName: string;
}

export const CELO_MAINNET_TOKENS: Record<TokenSymbol, TokenConfig> = {
  cUSD: {
    symbol: 'cUSD',
    address: '0x765DE816845861e75A25fCA122bb6898B8B1282a',
    decimals: 18,
    displayName: 'Celo Dollar',
  },
  USDT: {
    symbol: 'USDT',
    address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e',
    decimals: 6,
    displayName: 'Tether USD',
  },
  USDC: {
    symbol: 'USDC',
    address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
    decimals: 6,
    displayName: 'USD Coin',
  },
};

// Alfajores testnet — we will deploy MockERC20 instances in Task 15 and fill these in.
// Leave as zero address placeholder so code fails loudly if used before deploy.
export const CELO_ALFAJORES_TOKENS: Record<TokenSymbol, TokenConfig> = {
  cUSD: {
    symbol: 'cUSD',
    address: '0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1', // Alfajores cUSD
    decimals: 18,
    displayName: 'Celo Dollar (testnet)',
  },
  USDT: {
    symbol: 'USDT',
    address: '0x0000000000000000000000000000000000000000', // placeholder until Task 15
    decimals: 6,
    displayName: 'Mock USDT',
  },
  USDC: {
    symbol: 'USDC',
    address: '0x0000000000000000000000000000000000000000', // placeholder until Task 15
    decimals: 6,
    displayName: 'Mock USDC',
  },
};

export function getTokens(chainId: number): Record<TokenSymbol, TokenConfig> {
  if (chainId === celo.id) return CELO_MAINNET_TOKENS;
  if (chainId === celoAlfajores.id) return CELO_ALFAJORES_TOKENS;
  throw new Error(`Unsupported chain: ${chainId}`);
}

export const THREAD_PRICE_USD = 0.05;

export function computeTokenAmount(token: TokenConfig): bigint {
  // 0.05 * 10^decimals
  // For cUSD (18): 5 * 10^16
  // For USDT/USDC (6): 50_000
  return BigInt(5) * BigInt(10) ** BigInt(token.decimals - 2);
}
```

- [ ] **Step 2: Create lib/useBalances.ts**

```typescript
'use client';

import { useAccount, useChainId, useReadContracts } from 'wagmi';
import { erc20Abi, type Address } from 'viem';
import { getTokens, type TokenSymbol } from './tokens';

export interface TokenBalance {
  symbol: TokenSymbol;
  address: Address;
  decimals: number;
  balance: bigint;
  displayName: string;
}

export function useBalances() {
  const { address } = useAccount();
  const chainId = useChainId();

  const tokens = chainId ? getTokens(chainId) : null;
  const tokenList = tokens ? Object.values(tokens) : [];

  const { data, isLoading, refetch } = useReadContracts({
    contracts: tokenList.map((t) => ({
      address: t.address,
      abi: erc20Abi,
      functionName: 'balanceOf' as const,
      args: [address ?? '0x0000000000000000000000000000000000000000'],
    })),
    query: { enabled: Boolean(address && tokens) },
  });

  const balances: TokenBalance[] = tokenList.map((t, i) => ({
    ...t,
    balance: (data?.[i]?.result as bigint | undefined) ?? 0n,
  }));

  return { balances, isLoading, refetch };
}
```

- [ ] **Step 3: Create components/WalletStatus.tsx**

```tsx
'use client';

import { useAccount } from 'wagmi';
import { formatUnits } from 'viem';
import { useBalances } from '@/lib/useBalances';
import { Card } from '@/components/ui/card';

function shorten(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function WalletStatus() {
  const { address, isConnected } = useAccount();
  const { balances, isLoading } = useBalances();

  if (!isConnected || !address) return null;

  return (
    <Card className="w-full max-w-md p-4 flex flex-col gap-2">
      <div className="flex justify-between items-center">
        <span className="text-xs text-muted-foreground">Connected</span>
        <span className="font-mono text-sm">{shorten(address)}</span>
      </div>
      <div className="border-t border-border pt-2 flex flex-col gap-1">
        {isLoading && <span className="text-xs text-muted-foreground">Loading balances…</span>}
        {!isLoading &&
          balances.map((b) => (
            <div key={b.symbol} className="flex justify-between text-sm">
              <span>{b.symbol}</span>
              <span className="font-mono">
                {Number(formatUnits(b.balance, b.decimals)).toFixed(2)}
              </span>
            </div>
          ))}
      </div>
    </Card>
  );
}
```

- [ ] **Step 4: Update app/page.tsx to render WalletStatus**

Replace `app/page.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import { useAccount, useConnect } from 'wagmi';
import { Button } from '@/components/ui/button';
import { useIsMiniPay } from '@/lib/minipay';
import { WalletStatus } from '@/components/WalletStatus';

export default function Home() {
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const isMiniPay = useIsMiniPay();

  useEffect(() => {
    if (isMiniPay && !isConnected && connectors[0]) {
      connect({ connector: connectors[0] });
    }
  }, [isMiniPay, isConnected, connect, connectors]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-start gap-6 p-6 pt-12">
      <h1 className="text-4xl font-bold text-primary">ShipPost</h1>
      {isMiniPay && (
        <span className="text-xs px-2 py-1 rounded-full bg-primary/20 text-primary">
          MiniPay detected
        </span>
      )}
      {isConnected ? (
        <WalletStatus />
      ) : (
        <Button onClick={() => connect({ connector: connectors[0] })}>
          Connect wallet
        </Button>
      )}
    </main>
  );
}
```

- [ ] **Step 5: Verify balances render**

```bash
pnpm dev
```

Connect wallet (MetaMask) to Alfajores testnet at http://localhost:3000. Should see wallet card with cUSD balance (USDT/USDC will be 0 since addresses are placeholders). Stop.

- [ ] **Step 6: Commit**

```bash
git add lib/tokens.ts lib/useBalances.ts components/WalletStatus.tsx app/page.tsx
git commit -m "feat: show wallet balances for cUSD/USDT/USDC"
```

---

## Task 7: Initialize Hardhat for Solidity

**Files:**
- Create: `/Users/vanhuy/shippost/hardhat.config.ts`
- Create: `/Users/vanhuy/shippost/.env.example`

- [ ] **Step 1: Install Hardhat and plugins**

```bash
pnpm add -D hardhat @nomicfoundation/hardhat-toolbox-viem @nomicfoundation/hardhat-viem @openzeppelin/contracts dotenv
```

- [ ] **Step 2: Create hardhat.config.ts**

```typescript
import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox-viem';
import * as dotenv from 'dotenv';

dotenv.config();

const DEPLOYER_PK = process.env.DEPLOYER_PRIVATE_KEY || '0x' + '0'.repeat(64);
const FORK_URL = process.env.CELO_FORK_URL || 'https://forno.celo.org';
const FORK_BLOCK = process.env.CELO_FORK_BLOCK ? parseInt(process.env.CELO_FORK_BLOCK) : undefined;

const config: HardhatUserConfig = {
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
      chainId: 31337,
      // Mainnet fork — used by decimal tests (Task 10-11) to test against real token contracts.
      // Set CELO_FORK=true in .env to activate; leave unset for fast local tests.
      ...(process.env.CELO_FORK === 'true' && {
        forking: {
          url: FORK_URL,
          ...(FORK_BLOCK && { blockNumber: FORK_BLOCK }),
        },
      }),
    },
    alfajores: {
      url: 'https://alfajores-forno.celo-testnet.org',
      accounts: [DEPLOYER_PK],
      chainId: 44787,
    },
    celo: {
      url: 'https://forno.celo.org',
      accounts: [DEPLOYER_PK],
      chainId: 42220,
    },
  },
};

export default config;
```

- [ ] **Step 3: Create .env.example**

```
# Deployer wallet private key (NEVER commit real key)
DEPLOYER_PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000000

# Contract addresses (filled in after deploy — Task 15)
NEXT_PUBLIC_PAYMENT_CONTRACT_ALFAJORES=
NEXT_PUBLIC_AGENT_WALLET_ALFAJORES=
NEXT_PUBLIC_MOCK_USDT_ALFAJORES=
NEXT_PUBLIC_MOCK_USDC_ALFAJORES=

# Groq API key (free tier)
GROQ_API_KEY=

# Orchestrator wallet private key (for x402 proxy to sign/execute calls)
ORCHESTRATOR_PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000000

# x402 settle mode — set to "true" in Week 1 to skip on-chain settle (mock only).
# Flip to "false" in Week 2 when wiring real AgentWallet.executeX402Call.
MOCK_SETTLE=true

# Hardhat mainnet fork — set CELO_FORK=true to run decimal tests against real token contracts.
# Leave CELO_FORK_BLOCK empty to use latest block (slower but always fresh).
CELO_FORK=false
CELO_FORK_URL=https://forno.celo.org
CELO_FORK_BLOCK=
```

- [ ] **Step 4: Create .env (gitignored, with real values)**

```bash
cp .env.example .env
```

Edit `.env` to put your real Alfajores deployer private key (from wallet export; ensure it has ≥2 CELO from faucet) in `DEPLOYER_PRIVATE_KEY`. Leave `ORCHESTRATOR_PRIVATE_KEY` the same as deployer for MVP simplicity.

- [ ] **Step 5: Verify Hardhat runs**

```bash
pnpm compile
```

Expected: "Compiled 0 Solidity files successfully" (no contracts yet — that's fine).

- [ ] **Step 6: Commit**

```bash
git add hardhat.config.ts .env.example package.json pnpm-lock.yaml
git commit -m "chore: initialize Hardhat for Celo networks"
```

---

## Task 8: MockERC20 for tests

**Files:**
- Create: `/Users/vanhuy/shippost/contracts/mocks/MockERC20.sol`

- [ ] **Step 1: Create MockERC20.sol**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

- [ ] **Step 2: Compile**

```bash
pnpm compile
```

Expected: "Compiled 1 Solidity file successfully".

- [ ] **Step 3: Commit**

```bash
git add contracts/mocks/MockERC20.sol
git commit -m "feat: add MockERC20 for testing multi-decimal tokens"
```

---

## Task 9: ShipPostPayment.sol — scaffold + deployment test

**Files:**
- Create: `/Users/vanhuy/shippost/contracts/ShipPostPayment.sol`
- Create: `/Users/vanhuy/shippost/test/ShipPostPayment.t.ts`

- [ ] **Step 1: Write failing deployment test**

Create `test/ShipPostPayment.t.ts`:

```typescript
import { expect } from 'chai';
import { network } from 'hardhat';

describe('ShipPostPayment', () => {
  it('deploys with correct initial state', async () => {
    const { viem } = await network.connect();
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
});
```

- [ ] **Step 2: Run test, confirm it fails**

```bash
pnpm test:contracts
```

Expected: FAIL — artifact for `ShipPostPayment` not found.

- [ ] **Step 3: Write minimal ShipPostPayment.sol**

Create `contracts/ShipPostPayment.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

contract ShipPostPayment is Ownable, Pausable, ReentrancyGuard {
    address public agentWallet;
    address public treasury;
    address public reservePool;

    uint256 public threadCounter;

    mapping(address => bool) public allowedTokens;

    // Splits in basis points (must sum to 10000)
    uint256 public agentBp = 5000;    // 50%
    uint256 public treasuryBp = 4000; // 40%
    uint256 public reserveBp = 1000;  // 10%

    event ThreadRequested(
        address indexed user,
        uint256 indexed threadId,
        uint8 mode,
        address token,
        uint256 amount
    );
    event TokenAllowed(address indexed token, bool allowed);
    event FeeSplitUpdated(uint256 agentBp, uint256 treasuryBp, uint256 reserveBp);

    constructor(
        address _agentWallet,
        address _treasury,
        address _reservePool
    ) Ownable(msg.sender) {
        require(_agentWallet != address(0) && _treasury != address(0) && _reservePool != address(0), "ZERO_ADDR");
        agentWallet = _agentWallet;
        treasury = _treasury;
        reservePool = _reservePool;
    }

    function setAllowedToken(address token, bool allowed) external onlyOwner {
        allowedTokens[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    function updateFeeSplit(uint256 _agentBp, uint256 _treasuryBp, uint256 _reserveBp) external onlyOwner {
        require(_agentBp + _treasuryBp + _reserveBp == 10000, "BP_SUM");
        agentBp = _agentBp;
        treasuryBp = _treasuryBp;
        reserveBp = _reserveBp;
        emit FeeSplitUpdated(_agentBp, _treasuryBp, _reserveBp);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Compute the required amount for a $0.05 thread in this token.
    function requiredAmount(address token) public view returns (uint256) {
        uint8 d = IERC20Metadata(token).decimals();
        require(d >= 2, "BAD_DECIMALS");
        // $0.05 = 5 * 10^(d-2)
        return 5 * (10 ** (d - 2));
    }

    function payForThread(address token, uint8 mode)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 threadId)
    {
        require(allowedTokens[token], "TOKEN_NOT_ALLOWED");
        uint256 amount = requiredAmount(token);

        IERC20(token).transferFrom(msg.sender, address(this), amount);

        uint256 agentShare = (amount * agentBp) / 10000;
        uint256 treasuryShare = (amount * treasuryBp) / 10000;
        uint256 reserveShare = amount - agentShare - treasuryShare;

        require(IERC20(token).transfer(agentWallet, agentShare), "TRANSFER_AGENT");
        require(IERC20(token).transfer(treasury, treasuryShare), "TRANSFER_TREASURY");
        require(IERC20(token).transfer(reservePool, reserveShare), "TRANSFER_RESERVE");

        threadCounter++;
        threadId = threadCounter;
        emit ThreadRequested(msg.sender, threadId, mode, token, amount);
    }
}
```

- [ ] **Step 4: Run test, confirm it passes**

```bash
pnpm test:contracts
```

Expected: 1 passing.

- [ ] **Step 5: Commit**

```bash
git add contracts/ShipPostPayment.sol test/ShipPostPayment.t.ts
git commit -m "feat: ShipPostPayment contract with deployment test"
```

---

## Task 10: ShipPostPayment — test payForThread with cUSD (18 decimals)

**Files:**
- Modify: `/Users/vanhuy/shippost/test/ShipPostPayment.t.ts`

- [ ] **Step 1: Add test for single-token cUSD pay**

Append to `test/ShipPostPayment.t.ts`:

```typescript
  it('accepts 0.05 cUSD and splits 50/40/10', async () => {
    const { viem } = await network.connect();
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
```

- [ ] **Step 2: Run test, expect PASS (we already implemented logic in Task 9)**

```bash
pnpm test:contracts
```

Expected: 2 passing.

- [ ] **Step 3: Commit**

```bash
git add test/ShipPostPayment.t.ts
git commit -m "test: verify cUSD payment splits correctly"
```

---

## Task 11: ShipPostPayment — test multi-decimal tokens (USDT/USDC, 6 decimals)

**Files:**
- Modify: `/Users/vanhuy/shippost/test/ShipPostPayment.t.ts`

- [ ] **Step 1: Add test for USDT (6 decimals)**

Append to `test/ShipPostPayment.t.ts`:

```typescript
  // ── Mainnet fork variant ───────────────────────────────────────────────────
  // Run with CELO_FORK=true to test against real cUSD/USDT/USDC contracts on Celo.
  // These use impersonation so no real funds are needed.
  //
  // Real Celo mainnet token addresses:
  //   cUSD  0x765DE816845861e75A25fCA122bb6898B8B1282a  (18 decimals)
  //   USDT  0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e  (6 decimals)
  //   USDC  0xcebA9300f2b948710d2653dD7B07f33A8B32118C  (6 decimals)
  //
  // Example (add to a separate test/ShipPostPayment.fork.t.ts file):
  //
  //   it('accepts 0.05 real cUSD (mainnet fork)', async () => {
  //     const { viem, network: hn } = await hre.network.connect();
  //     const CUSD = '0x765DE816845861e75A25fCA122bb6898B8B1282a';
  //     const whale = '0xD533Ca259b330c7A88f74E000a3FaEa2d63B7972'; // holds cUSD
  //     await hn.provider.request({ method: 'hardhat_impersonateAccount', params: [whale] });
  //     // ... same assertions as mock test but with real token
  //   });
  //
  // Why: the mock tests (below) verify contract logic. Fork tests verify that
  // IERC20Metadata(token).decimals() returns the real value (6 vs 18) and that
  // the split math doesn't silently overflow or truncate on mainnet.
  // ──────────────────────────────────────────────────────────────────────────

  it('accepts 0.05 USDT (6 decimals) with correct scaled amount', async () => {
    const { viem } = await network.connect();
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
    const { viem } = await network.connect();
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
```

- [ ] **Step 2: Run tests**

```bash
pnpm test:contracts
```

Expected: 4 passing.

- [ ] **Step 3: Commit**

```bash
git add test/ShipPostPayment.t.ts
git commit -m "test: verify USDT (6 decimals) and whitelist rejection"
```

---

## Task 12: ShipPostPayment — event emission + pause tests

**Files:**
- Modify: `/Users/vanhuy/shippost/test/ShipPostPayment.t.ts`

- [ ] **Step 1: Add event + pause tests**

Append to `test/ShipPostPayment.t.ts`:

```typescript
  it('emits ThreadRequested with correct args', async () => {
    const { viem } = await network.connect();
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
    const { viem } = await network.connect();
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
```

- [ ] **Step 2: Run tests**

```bash
pnpm test:contracts
```

Expected: 6 passing.

- [ ] **Step 3: Commit**

```bash
git add test/ShipPostPayment.t.ts
git commit -m "test: verify event emission and pause behavior"
```

---

## Task 13: AgentWallet.sol — scaffold + deployment test

**Files:**
- Create: `/Users/vanhuy/shippost/contracts/AgentWallet.sol`
- Create: `/Users/vanhuy/shippost/test/AgentWallet.t.ts`

- [ ] **Step 1: Write failing deployment test**

Create `test/AgentWallet.t.ts`:

```typescript
import { expect } from 'chai';
import { network } from 'hardhat';

describe('AgentWallet', () => {
  it('deploys with owner and zero caps', async () => {
    const { viem } = await network.connect();
    const [owner] = await viem.getWalletClients();

    const wallet = await viem.deployContract('AgentWallet', []);

    expect((await wallet.read.owner()).toLowerCase()).to.equal(owner.account.address.toLowerCase());
  });
});
```

- [ ] **Step 2: Run test, confirm fail**

```bash
pnpm test:contracts
```

Expected: FAIL — "AgentWallet" artifact not found.

- [ ] **Step 3: Write AgentWallet.sol**

Create `contracts/AgentWallet.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title AgentWallet — ERC-8004-style wallet for autonomous agents.
/// Holds stablecoins; spend cap per token per 24h window.
contract AgentWallet is Ownable, ReentrancyGuard {
    // Per-token daily spend cap (in token smallest unit).
    mapping(address => uint256) public dailySpendCap;

    // Day number => token => amount spent that day.
    mapping(uint256 => mapping(address => uint256)) public spentOnDay;

    address public x402Facilitator; // address allowed to pull approved funds for x402 settlement

    event X402PaymentMade(
        address indexed service,
        address indexed token,
        uint256 amount,
        uint256 threadId
    );
    event DailyCapUpdated(address indexed token, uint256 cap);
    event FacilitatorUpdated(address indexed facilitator);
    event EmergencyWithdraw(address indexed token, uint256 amount, address indexed to);

    constructor() Ownable(msg.sender) {}

    function setDailySpendCap(address token, uint256 cap) external onlyOwner {
        dailySpendCap[token] = cap;
        emit DailyCapUpdated(token, cap);
    }

    function setFacilitator(address facilitator) external onlyOwner {
        x402Facilitator = facilitator;
        emit FacilitatorUpdated(facilitator);
    }

    function currentDay() public view returns (uint256) {
        return block.timestamp / 1 days;
    }

    /// @notice Pay an x402 service. Only the owner (orchestrator) can trigger.
    function executeX402Call(
        address service,
        address token,
        uint256 amount,
        uint256 threadId
    ) external onlyOwner nonReentrant {
        uint256 day = currentDay();
        require(spentOnDay[day][token] + amount <= dailySpendCap[token], "CAP_EXCEEDED");
        spentOnDay[day][token] += amount;

        require(IERC20(token).transfer(service, amount), "TRANSFER_FAIL");

        emit X402PaymentMade(service, token, amount, threadId);
    }

    /// @notice Owner can withdraw tokens in emergency (e.g., rebalancing or recovery).
    function emergencyWithdraw(address token, uint256 amount, address to) external onlyOwner {
        require(IERC20(token).transfer(to, amount), "WITHDRAW_FAIL");
        emit EmergencyWithdraw(token, amount, to);
    }

    /// @notice Approve facilitator to pull up to amount. Used if the facilitator settles via pull pattern.
    function approveFacilitator(address token, uint256 amount) external onlyOwner {
        require(x402Facilitator != address(0), "NO_FACILITATOR");
        require(IERC20(token).approve(x402Facilitator, amount), "APPROVE_FAIL");
    }
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm test:contracts
```

Expected: 7 passing (6 from ShipPostPayment + 1 new).

- [ ] **Step 5: Commit**

```bash
git add contracts/AgentWallet.sol test/AgentWallet.t.ts
git commit -m "feat: AgentWallet with per-token daily spend cap"
```

---

## Task 14: AgentWallet — executeX402Call tests

**Files:**
- Modify: `/Users/vanhuy/shippost/test/AgentWallet.t.ts`

- [ ] **Step 1: Add tests for cap enforcement + onlyOwner + event emission**

Append to `test/AgentWallet.t.ts`:

```typescript
  it('transfers tokens and emits event when within cap', async () => {
    const { viem } = await network.connect();
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
    const { viem } = await network.connect();
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
    const { viem } = await network.connect();
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
```

- [ ] **Step 2: Run tests**

```bash
pnpm test:contracts
```

Expected: 10 passing.

- [ ] **Step 3: Commit**

```bash
git add test/AgentWallet.t.ts
git commit -m "test: verify AgentWallet cap enforcement and access control"
```

---

## Task 15: Deploy to Alfajores testnet

**Files:**
- Create: `/Users/vanhuy/shippost/scripts/deploy.ts`
- Modify: `/Users/vanhuy/shippost/.env` (after deploy)
- Modify: `/Users/vanhuy/shippost/lib/tokens.ts` (after deploy)

- [ ] **Step 1: Write deploy script**

Create `scripts/deploy.ts`:

```typescript
import { network } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const { viem } = await network.connect();
  const [deployer] = await viem.getWalletClients();
  console.log('Deployer:', deployer.account.address);

  // Deploy mocks for USDT and USDC on Alfajores (cUSD is real at 0x874069...)
  const mockUsdt = await viem.deployContract('MockERC20', ['Mock Tether', 'USDT', 6]);
  console.log('MockUSDT:', mockUsdt.address);

  const mockUsdc = await viem.deployContract('MockERC20', ['Mock USDC', 'USDC', 6]);
  console.log('MockUSDC:', mockUsdc.address);

  // Deploy AgentWallet first — its address is needed by Payment
  const agentWallet = await viem.deployContract('AgentWallet', []);
  console.log('AgentWallet:', agentWallet.address);

  // Use deployer as both treasury and reservePool for MVP simplicity
  const payment = await viem.deployContract('ShipPostPayment', [
    agentWallet.address,
    deployer.account.address, // treasury
    deployer.account.address, // reservePool
  ]);
  console.log('ShipPostPayment:', payment.address);

  // Whitelist cUSD + mock tokens
  const CUSD_ALFAJORES = '0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1';
  await payment.write.setAllowedToken([CUSD_ALFAJORES, true]);
  await payment.write.setAllowedToken([mockUsdt.address, true]);
  await payment.write.setAllowedToken([mockUsdc.address, true]);

  // Set daily caps on AgentWallet (50 USD equivalent per token)
  await agentWallet.write.setDailySpendCap([CUSD_ALFAJORES, 50n * 10n ** 18n]);
  await agentWallet.write.setDailySpendCap([mockUsdt.address, 50_000_000n]); // 50 USDT (6 dec)
  await agentWallet.write.setDailySpendCap([mockUsdc.address, 50_000_000n]);

  // Write addresses to a file for frontend consumption
  const out = {
    network: 'alfajores',
    chainId: 44787,
    deployer: deployer.account.address,
    contracts: {
      ShipPostPayment: payment.address,
      AgentWallet: agentWallet.address,
      MockUSDT: mockUsdt.address,
      MockUSDC: mockUsdc.address,
    },
    tokens: {
      cUSD: CUSD_ALFAJORES,
      USDT: mockUsdt.address,
      USDC: mockUsdc.address,
    },
  };
  const outPath = path.join(__dirname, '..', 'deployments', 'alfajores.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`Wrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run deploy**

Make sure `.env` has `DEPLOYER_PRIVATE_KEY` set and the wallet has ≥2 CELO on Alfajores.

```bash
pnpm deploy:testnet
```

Expected: logs print contract addresses, `deployments/alfajores.json` created.

- [ ] **Step 3: Update .env with deployed addresses**

Open `deployments/alfajores.json` and copy the addresses into `.env`:

```
NEXT_PUBLIC_PAYMENT_CONTRACT_ALFAJORES=0x...
NEXT_PUBLIC_AGENT_WALLET_ALFAJORES=0x...
NEXT_PUBLIC_MOCK_USDT_ALFAJORES=0x...
NEXT_PUBLIC_MOCK_USDC_ALFAJORES=0x...
```

- [ ] **Step 4: Update lib/tokens.ts with real mock addresses**

In `lib/tokens.ts`, replace the USDT and USDC placeholder addresses in `CELO_ALFAJORES_TOKENS` with values from `deployments/alfajores.json`. For example:

```typescript
USDT: {
  symbol: 'USDT',
  address: '0xYOUR_MOCK_USDT_ADDRESS' as Address,
  decimals: 6,
  displayName: 'Mock USDT',
},
USDC: {
  symbol: 'USDC',
  address: '0xYOUR_MOCK_USDC_ADDRESS' as Address,
  decimals: 6,
  displayName: 'Mock USDC',
},
```

- [ ] **Step 5: Verify on Celoscan Alfajores**

Open https://alfajores.celoscan.io/address/<ShipPostPayment address> — confirm contract is visible and has transactions from deploy.

- [ ] **Step 6: Commit**

```bash
git add scripts/deploy.ts deployments/alfajores.json lib/tokens.ts
git commit -m "feat: deploy contracts to Alfajores testnet"
```

Note: do NOT commit `.env`.

---

## Task 16: Contracts config + ABI generation for frontend

**Files:**
- Create: `/Users/vanhuy/shippost/lib/contracts.ts`

- [ ] **Step 1: Create lib/contracts.ts exporting addresses + ABIs**

```typescript
import type { Address } from 'viem';
import { celoAlfajores, celo } from 'wagmi/chains';
import paymentArtifact from '@/artifacts/contracts/ShipPostPayment.sol/ShipPostPayment.json';
import agentArtifact from '@/artifacts/contracts/AgentWallet.sol/AgentWallet.json';

export const shipPostPaymentAbi = paymentArtifact.abi;
export const agentWalletAbi = agentArtifact.abi;

export interface ContractAddresses {
  ShipPostPayment: Address;
  AgentWallet: Address;
}

export const CONTRACTS: Record<number, ContractAddresses> = {
  [celoAlfajores.id]: {
    ShipPostPayment: (process.env.NEXT_PUBLIC_PAYMENT_CONTRACT_ALFAJORES ?? '0x0000000000000000000000000000000000000000') as Address,
    AgentWallet: (process.env.NEXT_PUBLIC_AGENT_WALLET_ALFAJORES ?? '0x0000000000000000000000000000000000000000') as Address,
  },
  [celo.id]: {
    // Filled in Week 2 mainnet deploy
    ShipPostPayment: '0x0000000000000000000000000000000000000000',
    AgentWallet: '0x0000000000000000000000000000000000000000',
  },
};

export function getContracts(chainId: number): ContractAddresses {
  const c = CONTRACTS[chainId];
  if (!c) throw new Error(`No contracts for chain ${chainId}`);
  return c;
}
```

- [ ] **Step 2: Update tsconfig.json to resolve @/artifacts**

In `tsconfig.json`, under `compilerOptions`:
- Set `"resolveJsonModule": true` (should already be there)
- Ensure `"include"` has `"artifacts/**/*.json"` OR simply trust that `**/*.ts` will pull the JSON via the import above.

Add to `include`:
```json
"include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", "artifacts/**/*.json"]
```

- [ ] **Step 3: Verify frontend type-checks**

```bash
pnpm build
```

Expected: build succeeds (may warn; errors means fix imports).

- [ ] **Step 4: Commit**

```bash
git add lib/contracts.ts tsconfig.json
git commit -m "feat: export contract ABIs + addresses for frontend"
```

---

## Task 17: usePayForThread hook

**Files:**
- Create: `/Users/vanhuy/shippost/lib/usePayForThread.ts`

- [ ] **Step 1: Create usePayForThread hook**

```typescript
'use client';

import { useCallback, useState } from 'react';
import { useAccount, useChainId, useWalletClient, usePublicClient } from 'wagmi';
import { erc20Abi, decodeEventLog, type Address } from 'viem';
import { getContracts, shipPostPaymentAbi } from './contracts';
import { computeTokenAmount, type TokenConfig } from './tokens';

export type PayStatus =
  | 'idle'
  | 'approving'
  | 'paying'
  | 'waiting-confirmation'
  | 'success'
  | 'error';

export interface PayResult {
  status: PayStatus;
  threadId: bigint | null;
  txHash: string | null;
  error: string | null;
  pay: (token: TokenConfig, mode: 0 | 1) => Promise<void>;
  reset: () => void;
}

export function usePayForThread(): PayResult {
  const { address } = useAccount();
  const chainId = useChainId();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const [status, setStatus] = useState<PayStatus>('idle');
  const [threadId, setThreadId] = useState<bigint | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStatus('idle');
    setThreadId(null);
    setTxHash(null);
    setError(null);
  }, []);

  const pay = useCallback(
    async (token: TokenConfig, mode: 0 | 1) => {
      if (!walletClient || !publicClient || !address || !chainId) {
        setError('Wallet not connected');
        setStatus('error');
        return;
      }

      try {
        const contracts = getContracts(chainId);
        const paymentAddr = contracts.ShipPostPayment;
        const amount = computeTokenAmount(token);

        // Check current allowance
        const allowance = (await publicClient.readContract({
          address: token.address,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [address, paymentAddr],
        })) as bigint;

        if (allowance < amount) {
          setStatus('approving');
          const approveHash = await walletClient.writeContract({
            address: token.address,
            abi: erc20Abi,
            functionName: 'approve',
            args: [paymentAddr, amount],
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }

        setStatus('paying');
        const payHash = await walletClient.writeContract({
          address: paymentAddr,
          abi: shipPostPaymentAbi,
          functionName: 'payForThread',
          args: [token.address, mode],
        });
        setTxHash(payHash);

        setStatus('waiting-confirmation');
        const receipt = await publicClient.waitForTransactionReceipt({ hash: payHash });

        // Find ThreadRequested event to extract threadId
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: shipPostPaymentAbi,
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName === 'ThreadRequested') {
              setThreadId((decoded.args as any).threadId as bigint);
              break;
            }
          } catch {
            // not our event
          }
        }

        setStatus('success');
      } catch (e: any) {
        setError(e.shortMessage ?? e.message ?? 'Payment failed');
        setStatus('error');
      }
    },
    [walletClient, publicClient, address, chainId]
  );

  return { status, threadId, txHash, error, pay, reset };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/usePayForThread.ts
git commit -m "feat: add usePayForThread hook with approve + pay flow"
```

---

## Task 18: Mode picker + Educational input UI

**Files:**
- Create: `/Users/vanhuy/shippost/components/ModePicker.tsx`
- Create: `/Users/vanhuy/shippost/components/EducationalInput.tsx`
- Create: `/Users/vanhuy/shippost/components/TokenSelector.tsx`

- [ ] **Step 1: Install additional shadcn components**

```bash
pnpm dlx shadcn@latest add input textarea select label radio-group
```

- [ ] **Step 2: Create TokenSelector**

Create `components/TokenSelector.tsx`:

```tsx
'use client';

import { formatUnits } from 'viem';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import type { TokenBalance } from '@/lib/useBalances';

interface Props {
  balances: TokenBalance[];
  selected: TokenBalance | null;
  onSelect: (token: TokenBalance) => void;
}

export function TokenSelector({ balances, selected, onSelect }: Props) {
  if (balances.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs text-muted-foreground">Pay with</Label>
      <Select
        value={selected?.symbol ?? ''}
        onValueChange={(sym) => {
          const t = balances.find((b) => b.symbol === sym);
          if (t) onSelect(t);
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder="Select token" />
        </SelectTrigger>
        <SelectContent>
          {balances.map((b) => (
            <SelectItem key={b.symbol} value={b.symbol}>
              <span className="flex justify-between gap-4 w-full">
                <span>{b.symbol}</span>
                <span className="text-muted-foreground font-mono text-xs">
                  {Number(formatUnits(b.balance, b.decimals)).toFixed(2)}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
```

- [ ] **Step 3: Create ModePicker**

Create `components/ModePicker.tsx`:

```tsx
'use client';

import { Card } from '@/components/ui/card';

interface Props {
  onSelect: (mode: 'educational' | 'hot-take') => void;
}

export function ModePicker({ onSelect }: Props) {
  return (
    <div className="w-full max-w-md flex flex-col gap-3">
      <h2 className="text-lg font-semibold">What are you writing today?</h2>

      <Card
        onClick={() => onSelect('educational')}
        className="p-4 cursor-pointer hover:border-primary transition-colors"
      >
        <div className="flex items-start gap-3">
          <span className="text-2xl">🎓</span>
          <div>
            <h3 className="font-semibold">Educational Thread</h3>
            <p className="text-sm text-muted-foreground">
              Explain a concept. e.g. "How ZK rollups work"
            </p>
          </div>
        </div>
      </Card>

      <Card
        onClick={() => onSelect('hot-take')}
        className="p-4 cursor-pointer hover:border-primary transition-colors opacity-60"
      >
        <div className="flex items-start gap-3">
          <span className="text-2xl">🔥</span>
          <div>
            <h3 className="font-semibold">Hot Take <span className="text-xs text-muted-foreground">(Week 3)</span></h3>
            <p className="text-sm text-muted-foreground">
              React to news with data. Not yet available.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Create EducationalInput**

Create `components/EducationalInput.tsx`:

```tsx
'use client';

import { useState, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { TokenSelector } from './TokenSelector';
import { useBalances, type TokenBalance } from '@/lib/useBalances';
import { computeTokenAmount } from '@/lib/tokens';
import { formatUnits } from 'viem';

export interface EducationalSubmitPayload {
  topic: string;
  audience: 'beginner' | 'intermediate' | 'advanced';
  length: 5 | 8 | 12;
  token: TokenBalance;
}

interface Props {
  onSubmit: (payload: EducationalSubmitPayload) => void;
  disabled?: boolean;
}

export function EducationalInput({ onSubmit, disabled }: Props) {
  const { balances, isLoading } = useBalances();
  const [topic, setTopic] = useState('');
  const [audience, setAudience] = useState<'beginner' | 'intermediate' | 'advanced'>('beginner');
  const [length, setLength] = useState<5 | 8 | 12>(8);

  // Auto-select highest balance
  const defaultToken = useMemo(() => {
    if (!balances.length) return null;
    return [...balances].sort((a, b) => (a.balance > b.balance ? -1 : 1))[0];
  }, [balances]);

  const [selectedToken, setSelectedToken] = useState<TokenBalance | null>(defaultToken);

  // When balances load for first time, sync selected
  if (!selectedToken && defaultToken) {
    setSelectedToken(defaultToken);
  }

  const canSubmit = topic.trim().length > 0 && selectedToken !== null && !disabled;

  const amountStr = selectedToken
    ? Number(formatUnits(computeTokenAmount(selectedToken), selectedToken.decimals)).toFixed(2)
    : '';

  return (
    <Card className="w-full max-w-md p-4 flex flex-col gap-4">
      <h2 className="text-lg font-semibold">🎓 Educational Thread</h2>

      <div className="flex flex-col gap-1">
        <Label htmlFor="topic">Topic</Label>
        <Input
          id="topic"
          placeholder="e.g. EIP-7702 account abstraction"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Audience</Label>
        <RadioGroup
          value={audience}
          onValueChange={(v) => setAudience(v as typeof audience)}
          className="flex gap-4"
        >
          <label className="flex items-center gap-1.5">
            <RadioGroupItem value="beginner" />
            <span className="text-sm">Beginner</span>
          </label>
          <label className="flex items-center gap-1.5">
            <RadioGroupItem value="intermediate" />
            <span className="text-sm">Intermediate</span>
          </label>
          <label className="flex items-center gap-1.5">
            <RadioGroupItem value="advanced" />
            <span className="text-sm">Advanced</span>
          </label>
        </RadioGroup>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Length</Label>
        <RadioGroup
          value={String(length)}
          onValueChange={(v) => setLength(Number(v) as 5 | 8 | 12)}
          className="flex gap-4"
        >
          <label className="flex items-center gap-1.5">
            <RadioGroupItem value="5" />
            <span className="text-sm">5 tweets</span>
          </label>
          <label className="flex items-center gap-1.5">
            <RadioGroupItem value="8" />
            <span className="text-sm">8 tweets</span>
          </label>
          <label className="flex items-center gap-1.5">
            <RadioGroupItem value="12" />
            <span className="text-sm">12 tweets</span>
          </label>
        </RadioGroup>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading balances…</p>
      ) : (
        <TokenSelector
          balances={balances}
          selected={selectedToken}
          onSelect={setSelectedToken}
        />
      )}

      <Button
        disabled={!canSubmit}
        onClick={() => {
          if (canSubmit && selectedToken) {
            onSubmit({ topic, audience, length, token: selectedToken });
          }
        }}
      >
        {selectedToken ? `Generate for ${amountStr} ${selectedToken.symbol} →` : 'Select token'}
      </Button>
    </Card>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add components/ModePicker.tsx components/EducationalInput.tsx components/TokenSelector.tsx
git commit -m "feat: add ModePicker, EducationalInput, TokenSelector UI"
```

---

## Task 19: Wire UI to pay flow + GeneratingStatus

**Files:**
- Create: `/Users/vanhuy/shippost/components/GeneratingStatus.tsx`
- Modify: `/Users/vanhuy/shippost/app/page.tsx`

- [ ] **Step 1: Create GeneratingStatus component (static placeholder for Week 1)**

Create `components/GeneratingStatus.tsx`:

```tsx
'use client';

import { Card } from '@/components/ui/card';

interface Props {
  txHash: string | null;
  threadId: bigint | null;
  mockOutput: string | null;
  chainExplorerBase: string;
}

export function GeneratingStatus({ txHash, threadId, mockOutput, chainExplorerBase }: Props) {
  return (
    <Card className="w-full max-w-md p-4 flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Generating your thread…</h2>
      <ul className="text-sm flex flex-col gap-1">
        <li>💸 Payment confirmed {txHash ? '✓' : '⏳'}</li>
        <li>✍️ Writing thread {mockOutput ? '✓' : '⏳'}</li>
      </ul>
      {txHash && (
        <a
          href={`${chainExplorerBase}/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary underline"
        >
          View pay tx on explorer →
        </a>
      )}
      {threadId && (
        <p className="text-xs text-muted-foreground">Thread #{threadId.toString()}</p>
      )}
      {mockOutput && (
        <div className="border-t border-border pt-3">
          <h3 className="text-sm font-semibold mb-2">Output (mock)</h3>
          <pre className="text-xs whitespace-pre-wrap">{mockOutput}</pre>
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Update app/page.tsx to orchestrate the flow**

Replace `app/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useAccount, useConnect, useChainId } from 'wagmi';
import { Button } from '@/components/ui/button';
import { useIsMiniPay } from '@/lib/minipay';
import { WalletStatus } from '@/components/WalletStatus';
import { ModePicker } from '@/components/ModePicker';
import { EducationalInput, type EducationalSubmitPayload } from '@/components/EducationalInput';
import { GeneratingStatus } from '@/components/GeneratingStatus';
import { usePayForThread } from '@/lib/usePayForThread';

type Screen = 'mode' | 'educational' | 'generating';

export default function Home() {
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const isMiniPay = useIsMiniPay();
  const chainId = useChainId();

  const [screen, setScreen] = useState<Screen>('mode');
  const [mockOutput, setMockOutput] = useState<string | null>(null);
  const { pay, status, threadId, txHash, error, reset } = usePayForThread();

  useEffect(() => {
    if (isMiniPay && !isConnected && connectors[0]) {
      connect({ connector: connectors[0] });
    }
  }, [isMiniPay, isConnected, connect, connectors]);

  // When pay succeeds, trigger mock x402 call (real call in Task 21+)
  useEffect(() => {
    if (status === 'success' && threadId && !mockOutput) {
      (async () => {
        const res = await fetch('/api/x402/groq', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ threadId: threadId.toString(), topic: 'test', mode: 0 }),
        });
        const json = await res.json();
        setMockOutput(json.output ?? 'No output');
      })();
    }
  }, [status, threadId, mockOutput]);

  const explorerBase = chainId === 44787
    ? 'https://alfajores.celoscan.io'
    : 'https://celoscan.io';

  async function handleEducationalSubmit(p: EducationalSubmitPayload) {
    setScreen('generating');
    await pay(p.token, 0);
  }

  return (
    <main className="min-h-screen flex flex-col items-center gap-6 p-6 pt-8">
      <div className="flex items-center gap-3">
        <h1 className="text-3xl font-bold text-primary">ShipPost</h1>
        {isMiniPay && (
          <span className="text-xs px-2 py-1 rounded-full bg-primary/20 text-primary">
            MiniPay
          </span>
        )}
      </div>

      {!isConnected ? (
        <Button onClick={() => connect({ connector: connectors[0] })}>Connect wallet</Button>
      ) : (
        <>
          <WalletStatus />
          {screen === 'mode' && (
            <ModePicker
              onSelect={(m) => {
                if (m === 'educational') setScreen('educational');
              }}
            />
          )}
          {screen === 'educational' && (
            <EducationalInput
              onSubmit={handleEducationalSubmit}
              disabled={status === 'approving' || status === 'paying'}
            />
          )}
          {screen === 'generating' && (
            <GeneratingStatus
              txHash={txHash}
              threadId={threadId}
              mockOutput={mockOutput}
              chainExplorerBase={explorerBase}
            />
          )}
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          {screen === 'generating' && status === 'success' && mockOutput && (
            <Button
              variant="outline"
              onClick={() => {
                reset();
                setMockOutput(null);
                setScreen('mode');
              }}
            >
              Write another
            </Button>
          )}
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/GeneratingStatus.tsx app/page.tsx
git commit -m "feat: wire UI to pay flow with mock x402 call"
```

---

## Task 20: x402 proxy — mock Groq endpoint

**Files:**
- Create: `/Users/vanhuy/shippost/app/api/x402/groq/route.ts`

- [ ] **Step 1: Create mock proxy route (no real Groq call yet)**

Create `app/api/x402/groq/route.ts`:

```typescript
import { NextResponse } from 'next/server';

interface GroqRequest {
  threadId: string;
  topic: string;
  mode: 0 | 1;
}

export async function POST(req: Request) {
  const body = (await req.json()) as GroqRequest;

  // MOCK_SETTLE=true (default in Week 1) — no on-chain settlement.
  // Flip to false in Week 2 when AgentWallet.executeX402Call is ready.
  // See Task 21 for the real implementation.
  const mockSettle = process.env.MOCK_SETTLE !== 'false';
  if (mockSettle) {
    console.log(`[MOCK] x402 settle skipped for threadId=${body.threadId}`);
  }

  const mock = [
    `1/ (mock) Thread about: ${body.topic}`,
    `2/ This is a placeholder response from the x402 proxy.`,
    `3/ Thread id: ${body.threadId}`,
    `4/ Replaced with real Groq generation in Task 21.`,
  ].join('\n\n');

  return NextResponse.json({ output: mock, settled: !mockSettle });
}
```

- [ ] **Step 2: Test manually**

```bash
pnpm dev
```

In another terminal:

```bash
curl -X POST http://localhost:3000/api/x402/groq \
  -H "Content-Type: application/json" \
  -d '{"threadId":"1","topic":"EIP-7702","mode":0}'
```

Expected: JSON `{"output": "1/ (mock) Thread about: EIP-7702..."}`.

- [ ] **Step 3: Commit**

```bash
git add app/api/x402/groq/route.ts
git commit -m "feat: mock x402 Groq proxy endpoint"
```

---

## Task 21: x402 proxy — real Groq call with on-chain settlement

**Files:**
- Modify: `/Users/vanhuy/shippost/app/api/x402/groq/route.ts`
- Create: `/Users/vanhuy/shippost/lib/orchestrator.ts`

- [ ] **Step 1: Install Groq SDK**

```bash
pnpm add groq-sdk
```

- [ ] **Step 2: Create orchestrator helper to settle x402 on-chain**

Create `lib/orchestrator.ts`:

```typescript
import { createWalletClient, createPublicClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celoAlfajores, celo } from 'viem/chains';
import { agentWalletAbi, getContracts } from './contracts';
import { getTokens } from './tokens';

function getChain(chainId: number) {
  if (chainId === celoAlfajores.id) return celoAlfajores;
  if (chainId === celo.id) return celo;
  throw new Error(`Unsupported chain ${chainId}`);
}

export async function settleX402Call(params: {
  chainId: number;
  serviceAddress: Address;
  tokenSymbol: 'cUSD' | 'USDT' | 'USDC';
  amount: bigint;
  threadId: bigint;
}) {
  const pk = process.env.ORCHESTRATOR_PRIVATE_KEY as `0x${string}` | undefined;
  if (!pk) throw new Error('ORCHESTRATOR_PRIVATE_KEY missing');

  const account = privateKeyToAccount(pk);
  const chain = getChain(params.chainId);

  const wallet = createWalletClient({ account, chain, transport: http() });
  const publicClient = createPublicClient({ chain, transport: http() });

  const contracts = getContracts(params.chainId);
  const token = getTokens(params.chainId)[params.tokenSymbol];

  const hash = await wallet.writeContract({
    address: contracts.AgentWallet,
    abi: agentWalletAbi,
    functionName: 'executeX402Call',
    args: [params.serviceAddress, token.address, params.amount, params.threadId],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
```

- [ ] **Step 3: Replace app/api/x402/groq/route.ts with real flow**

```typescript
import { NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import { settleX402Call } from '@/lib/orchestrator';

interface GroqRequest {
  threadId: string;
  topic: string;
  mode: 0 | 1;
  chainId: number;
}

const SERVICE_ADDRESS = '0x000000000000000000000000000000000000dead' as const; // placeholder sink
const SERVICE_PRICE = 1000n; // 0.001 in 6-decimal token (USDT/USDC), negligible in cUSD units

export async function POST(req: Request) {
  const body = (await req.json()) as GroqRequest;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GROQ_API_KEY missing' }, { status: 500 });
  }

  const groq = new Groq({ apiKey });

  const prompt = body.mode === 0
    ? `Write a short, punchy X (Twitter) thread explaining ${body.topic} to beginners. Use 5 tweets max. Each tweet is its own paragraph, numbered 1/ 2/ 3/ ...`
    : `Write a hot take thread about: ${body.topic}. 5 tweets.`;

  let output: string;
  try {
    const resp = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'You are a crypto/dev content writer. Keep tweets concise and high-signal.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 800,
    });
    output = resp.choices[0]?.message?.content ?? '(empty response)';
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Groq failed' }, { status: 502 });
  }

  // Settle x402 on-chain after successful LLM call
  try {
    await settleX402Call({
      chainId: body.chainId,
      serviceAddress: SERVICE_ADDRESS,
      tokenSymbol: 'cUSD',
      amount: 1_000_000_000_000_000n, // 0.001 cUSD (18 decimals)
      threadId: BigInt(body.threadId),
    });
  } catch (e: any) {
    // Log but don't fail the user request — thread still delivered
    console.error('x402 settlement failed:', e);
  }

  return NextResponse.json({ output });
}
```

- [ ] **Step 4: Update app/page.tsx to pass chainId**

In `app/page.tsx`, find the fetch call inside `useEffect` (around the `mockOutput` logic) and replace with:

```typescript
const res = await fetch('/api/x402/groq', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    threadId: threadId.toString(),
    topic: 'test topic',
    mode: 0,
    chainId,
  }),
});
```

(You'll need `chainId` in scope — it's already pulled from `useChainId()`.)

- [ ] **Step 5: Fund AgentWallet with testnet cUSD**

Send ~1 cUSD from your Alfajores wallet to the deployed `AgentWallet` address. On Celo Alfajores explorer, use the cUSD `transfer` method, or from MetaMask send cUSD token to the AgentWallet contract address.

Verify in `WalletStatus`-style check: open https://alfajores.celoscan.io/address/<AgentWallet>?token=0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1 and confirm balance.

- [ ] **Step 6: Test end-to-end**

With `.env` populated (GROQ_API_KEY, ORCHESTRATOR_PRIVATE_KEY, contract addresses):

```bash
pnpm dev
```

Walk through flow: connect → Educational mode → type topic "Transient storage in Solidity" → approve cUSD (if first time) → pay → see real Groq thread output → observe x402 settlement tx on Alfajores explorer.

- [ ] **Step 7: Commit**

```bash
git add app/api/x402/groq/route.ts lib/orchestrator.ts app/page.tsx package.json pnpm-lock.yaml
git commit -m "feat: x402 proxy with real Groq call and on-chain settlement"
```

---

## Task 22: Pass real topic from UI to backend

**Files:**
- Modify: `/Users/vanhuy/shippost/app/page.tsx`
- Modify: `/Users/vanhuy/shippost/components/EducationalInput.tsx`

- [ ] **Step 1: Plumb the submitted topic/audience/length through to the API call**

In `app/page.tsx`, update the state + useEffect:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useAccount, useConnect, useChainId } from 'wagmi';
import { Button } from '@/components/ui/button';
import { useIsMiniPay } from '@/lib/minipay';
import { WalletStatus } from '@/components/WalletStatus';
import { ModePicker } from '@/components/ModePicker';
import { EducationalInput, type EducationalSubmitPayload } from '@/components/EducationalInput';
import { GeneratingStatus } from '@/components/GeneratingStatus';
import { usePayForThread } from '@/lib/usePayForThread';

type Screen = 'mode' | 'educational' | 'generating';

export default function Home() {
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const isMiniPay = useIsMiniPay();
  const chainId = useChainId();

  const [screen, setScreen] = useState<Screen>('mode');
  const [submitted, setSubmitted] = useState<EducationalSubmitPayload | null>(null);
  const [mockOutput, setMockOutput] = useState<string | null>(null);
  const { pay, status, threadId, txHash, error, reset } = usePayForThread();

  useEffect(() => {
    if (isMiniPay && !isConnected && connectors[0]) {
      connect({ connector: connectors[0] });
    }
  }, [isMiniPay, isConnected, connect, connectors]);

  useEffect(() => {
    if (status === 'success' && threadId && submitted && !mockOutput) {
      (async () => {
        const res = await fetch('/api/x402/groq', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            threadId: threadId.toString(),
            topic: submitted.topic,
            audience: submitted.audience,
            length: submitted.length,
            mode: 0,
            chainId,
          }),
        });
        const json = await res.json();
        setMockOutput(json.output ?? json.error ?? 'No output');
      })();
    }
  }, [status, threadId, submitted, mockOutput, chainId]);

  const explorerBase = chainId === 44787
    ? 'https://alfajores.celoscan.io'
    : 'https://celoscan.io';

  async function handleEducationalSubmit(p: EducationalSubmitPayload) {
    setSubmitted(p);
    setScreen('generating');
    await pay(p.token, 0);
  }

  return (
    <main className="min-h-screen flex flex-col items-center gap-6 p-6 pt-8">
      <div className="flex items-center gap-3">
        <h1 className="text-3xl font-bold text-primary">ShipPost</h1>
        {isMiniPay && (
          <span className="text-xs px-2 py-1 rounded-full bg-primary/20 text-primary">
            MiniPay
          </span>
        )}
      </div>

      {!isConnected ? (
        <Button onClick={() => connect({ connector: connectors[0] })}>Connect wallet</Button>
      ) : (
        <>
          <WalletStatus />
          {screen === 'mode' && (
            <ModePicker
              onSelect={(m) => {
                if (m === 'educational') setScreen('educational');
              }}
            />
          )}
          {screen === 'educational' && (
            <EducationalInput
              onSubmit={handleEducationalSubmit}
              disabled={status === 'approving' || status === 'paying'}
            />
          )}
          {screen === 'generating' && (
            <GeneratingStatus
              txHash={txHash}
              threadId={threadId}
              mockOutput={mockOutput}
              chainExplorerBase={explorerBase}
            />
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {screen === 'generating' && status === 'success' && mockOutput && (
            <Button
              variant="outline"
              onClick={() => {
                reset();
                setMockOutput(null);
                setSubmitted(null);
                setScreen('mode');
              }}
            >
              Write another
            </Button>
          )}
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Update groq route to use audience + length**

Modify the `prompt` construction in `app/api/x402/groq/route.ts`:

```typescript
const audience = (body as any).audience ?? 'beginner';
const length = (body as any).length ?? 5;
const prompt = body.mode === 0
  ? `Write a punchy X (Twitter) thread explaining "${body.topic}" to a ${audience} audience. Produce exactly ${length} tweets. Format each tweet as "N/" followed by content, separated by blank lines. Keep tweets <280 chars.`
  : `Write a hot take thread about: ${body.topic}. ${length} tweets.`;
```

Also widen the `GroqRequest` type:

```typescript
interface GroqRequest {
  threadId: string;
  topic: string;
  mode: 0 | 1;
  chainId: number;
  audience?: 'beginner' | 'intermediate' | 'advanced';
  length?: 5 | 8 | 12;
}
```

- [ ] **Step 3: Manual test**

```bash
pnpm dev
```

Go through flow with topic "Merkle trees". Verify Groq produces a ~8-tweet thread about Merkle trees (not "test topic").

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx app/api/x402/groq/route.ts
git commit -m "feat: pass topic/audience/length to Groq generation"
```

---

## Task 23: Vercel preview deploy + MiniPay smoke test

**Files:**
- (no code changes; deploy and verify)

- [ ] **Step 1: Push to GitHub**

Create a public repo named `shippost` on GitHub (https://github.com/new), then:

```bash
cd /Users/vanhuy/shippost
git remote add origin git@github.com:<your-username>/shippost.git
git push -u origin main
```

- [ ] **Step 2: Import to Vercel**

In Vercel dashboard: Add new → Project → Import `shippost` repo. Framework preset: Next.js.

- [ ] **Step 3: Add env vars to Vercel**

In project settings → Environment Variables, add (for all envs: Production, Preview, Development):
- `DEPLOYER_PRIVATE_KEY` (your Alfajores deployer key)
- `ORCHESTRATOR_PRIVATE_KEY` (same as deployer for MVP)
- `GROQ_API_KEY`
- `NEXT_PUBLIC_PAYMENT_CONTRACT_ALFAJORES`
- `NEXT_PUBLIC_AGENT_WALLET_ALFAJORES`
- `NEXT_PUBLIC_MOCK_USDT_ALFAJORES`
- `NEXT_PUBLIC_MOCK_USDC_ALFAJORES`

- [ ] **Step 4: Deploy and get URL**

Vercel auto-deploys main. Note the production URL (e.g., `https://shippost.vercel.app`).

Visit it in desktop browser: verify Connect wallet → Educational → pay flow works against Alfajores.

- [ ] **Step 5: Smoke-test inside real MiniPay**

MiniPay currently points to Celo mainnet — for Week 1 testnet validation, open the Vercel URL in a mobile browser that exposes `window.ethereum.isMiniPay` (e.g., MetaMask mobile → browser, with the emulation trick from Task 5 Step 3: open DevTools remote debugging and set `window.ethereum.isMiniPay = true`).

Actual MiniPay integration against mainnet is validated in Week 2 when mainnet deploy happens. For Week 1, the gate is: the Vercel preview works against Alfajores from a mobile browser with simulated MiniPay flag.

- [ ] **Step 6: Commit Vercel config note**

No code change needed. Optionally update README with live URL:

```bash
# edit README.md to add "Live preview: https://shippost.vercel.app"
git add README.md
git commit -m "docs: add Vercel preview URL"
git push
```

---

## Task 24: Week 1 demo video + documentation

**Files:**
- Modify: `/Users/vanhuy/shippost/README.md`

- [ ] **Step 1: Record 30-second screencast**

Run the full flow on Alfajores:
1. Open Vercel URL
2. Auto-connect (or click Connect)
3. See wallet + balances
4. Pick Educational mode
5. Type topic "EIP-7702 for beginners"
6. Click Generate → approve → pay
7. See Groq-generated thread output
8. Click Celoscan link, show the pay tx and agent x402 settlement tx

Record with QuickTime Player or Loom. Keep under 60s.

- [ ] **Step 2: Upload to YouTube (unlisted) or Loom**

Copy the public URL.

- [ ] **Step 3: Update README.md**

```markdown
# ShipPost

The pay-per-post AI thread writer for crypto builders. $0.05/thread. No subscription. Powered by MiniPay.

Proof of Ship competition submission — April 2026.

## Status

🚧 **Week 1 of 4 — Foundation complete**

- ✅ Smart contracts deployed to Alfajores
- ✅ MiniPay detection + auto-connect
- ✅ Multi-token payment (cUSD + mock USDT + mock USDC)
- ✅ x402 proxy POC with real Groq generation
- ✅ End-to-end pay → agent → x402 loop on testnet
- ⏭️ Week 2: Celo mainnet deploy, Mode A polished, progress theatre, Flux thumbnails

## Live preview (Alfajores)

https://shippost.vercel.app

Demo: <paste your Loom/YouTube link>

## Local development

```bash
pnpm install
cp .env.example .env   # fill in keys
pnpm dev
```

## Architecture

See `docs/superpowers/specs/2026-04-24-shippost-minipay-design.md`.

## Deployed addresses (Alfajores)

| Contract | Address |
|---|---|
| ShipPostPayment | `<from deployments/alfajores.json>` |
| AgentWallet | `<from deployments/alfajores.json>` |

## License

MIT
```

Replace placeholders with your actual values.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: Week 1 gate — demo video + deployed addresses"
git push
```

---

## Task 25: Week 1 gate verification checklist

**Files:**
- (manual verification; no code changes)

- [ ] **Step 1: Verify Definition of Done**

Confirm each item works:

- [ ] `pnpm dev` runs without errors on a fresh clone
- [ ] Connect wallet works in desktop browser
- [ ] MiniPay simulation (set `window.ethereum.isMiniPay = true`) triggers auto-connect
- [ ] `WalletStatus` shows cUSD/USDT/USDC balances
- [ ] Educational mode picker opens EducationalInput
- [ ] Submitting triggers approve + pay txs on Alfajores
- [ ] Pay tx appears on https://alfajores.celoscan.io
- [ ] Agent wallet x402 settlement tx appears after LLM generation
- [ ] Groq thread output rendered in GeneratingStatus
- [ ] "Write another" resets state and returns to mode picker
- [ ] Vercel preview URL deploys + works
- [ ] 12/12 Hardhat tests pass (`pnpm test:contracts`)
- [ ] Demo video recorded and linked in README

- [ ] **Step 2: If any item fails, open an issue in your GitHub repo and fix before moving to Week 2 plan.**

- [ ] **Step 3: If all pass — Week 1 is done. Tag the commit.**

```bash
git tag -a week1-complete -m "Week 1 foundation complete"
git push origin week1-complete
```

---

## Week 1 Completion

When this plan is fully executed:

1. You'll have a working Alfajores testnet MVP that proves the pay → agent → x402 → output loop.
2. 12 unit tests passing on contracts (6 ShipPostPayment + 3 AgentWallet deployment-related + 3 executeX402Call).
3. A Vercel preview URL you can share with mentors for the Week 1 gate feedback.
4. A public GitHub repo with open-source code.
5. A demo video ready for mentor office hours.

Next: return to Claude and ask to generate **Plan 2 (Week 2 — Mode A mainnet ship)** informed by Week 1 learnings. Expect Plan 2 to cover: Celo mainnet deploy, progress theatre UI, fal.ai Flux thumbnails, bug bash with 5 friends, v0.1 launch.

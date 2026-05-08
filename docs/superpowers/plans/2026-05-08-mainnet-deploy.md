# Mainnet Deploy & Frontend Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy `AgentWallet` and `ShipPostPayment` to Celo mainnet (chainId 42220) and wire env vars so the frontend serves real users.

**Architecture:** Write a standalone `scripts/deploy-mainnet.ts` following the existing viem pattern in `scripts/deploy.ts`. Script deploys both contracts against real mainnet stablecoin addresses, sets $10/day spend caps, writes `deployments/celo.json`, and patches `.env.local`. Frontend code needs zero changes — `lib/contracts.ts` already reads mainnet addresses from env vars.

**Tech Stack:** Hardhat + `@nomicfoundation/hardhat-toolbox-viem`, viem, Celo mainnet RPC (`https://forno.celo.org`), Vercel CLI.

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `scripts/deploy-mainnet.ts` | Mainnet deploy script (no mock tokens) |
| Generated | `deployments/celo.json` | Contract addresses written by script |
| Patched | `.env.local` | `NEXT_PUBLIC_*_MAINNET` vars auto-set by script |

No frontend files need modification.

---

## Task 1: Write `scripts/deploy-mainnet.ts`

**Files:**
- Create: `scripts/deploy-mainnet.ts`

- [ ] **Step 1: Create the file**

Create `scripts/deploy-mainnet.ts` with the following content. This follows the exact same viem pattern used in `scripts/deploy.ts` (testnet), but skips mock token deployment and uses real mainnet addresses.

```typescript
import { network } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Real Celo mainnet stablecoin addresses (matches lib/tokens.ts CELO_MAINNET_TOKENS)
const MAINNET_TOKENS = {
  cUSD: '0x765DE816845861e75A25fCA122bb6898B8B1282a' as `0x${string}`,
  USDT: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e' as `0x${string}`,
  USDC: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C' as `0x${string}`,
};

// $10/day caps — cUSD has 18 decimals, USDT/USDC have 6
const DAILY_CAPS = {
  cUSD: 10n * 10n ** 18n,
  USDT: 10_000_000n,
  USDC: 10_000_000n,
};

function patchEnvLocal(key: string, value: string) {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, `${key}=${value}\n`);
    return;
  }
  let content = fs.readFileSync(envPath, 'utf8');
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content += `\n${key}=${value}`;
  }
  fs.writeFileSync(envPath, content);
}

async function main() {
  const { viem } = await network.create();
  const [deployer] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();
  const deployerAddr = deployer.account.address;
  console.log('Deployer:', deployerAddr);
  console.log('Network: Celo mainnet (chainId 42220)');

  // 1. Deploy AgentWallet — owner = deployer
  const agentWallet = await viem.deployContract('AgentWallet', []);
  console.log('AgentWallet:', agentWallet.address);

  // 2. Deploy ShipPostPayment — treasury and reservePool both = deployer (MVP)
  const payment = await viem.deployContract('ShipPostPayment', [
    agentWallet.address,
    deployerAddr, // treasury
    deployerAddr, // reservePool
  ]);
  console.log('ShipPostPayment:', payment.address);

  // 3. Whitelist real mainnet tokens on ShipPostPayment
  console.log('Whitelisting tokens...');
  for (const [symbol, addr] of Object.entries(MAINNET_TOKENS) as [string, `0x${string}`][]) {
    const hash = await payment.write.setAllowedToken([addr, true]);
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  ${symbol} whitelisted`);
    await sleep(2000);
  }

  // 4. Set $10/day spend caps on AgentWallet
  console.log('Setting daily spend caps ($10/day per token)...');
  for (const [symbol, addr] of Object.entries(MAINNET_TOKENS) as [string, `0x${string}`][]) {
    const cap = DAILY_CAPS[symbol as keyof typeof DAILY_CAPS];
    const hash = await agentWallet.write.setDailySpendCap([addr, cap]);
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  ${symbol} cap set`);
    await sleep(2000);
  }

  // 5. Write deployments/celo.json
  const out = {
    network: 'celo',
    chainId: 42220,
    deployer: deployerAddr,
    contracts: {
      ShipPostPayment: payment.address,
      AgentWallet: agentWallet.address,
    },
    tokens: MAINNET_TOKENS,
    dailyCapsUSD: 10,
    deployedAt: new Date().toISOString(),
  };
  const outPath = path.join(__dirname, '..', 'deployments', 'celo.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${outPath}`);

  // 6. Patch .env.local with mainnet contract addresses
  patchEnvLocal('NEXT_PUBLIC_PAYMENT_CONTRACT_MAINNET', payment.address);
  patchEnvLocal('NEXT_PUBLIC_AGENT_WALLET_MAINNET', agentWallet.address);
  console.log('Patched .env.local with mainnet addresses');

  console.log('\n=== DEPLOY COMPLETE ===');
  console.log('ShipPostPayment:', payment.address);
  console.log('AgentWallet:    ', agentWallet.address);
  console.log('\nNext: push env vars to Vercel (see Task 4)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm compile
```

Expected: `Compiled N Solidity files successfully` — no TypeScript errors in output.

- [ ] **Step 3: Commit the script**

```bash
git add scripts/deploy-mainnet.ts
git commit -m "feat(scripts): mainnet deploy script with \$10/day caps"
```

---

## Task 2: Pre-deploy verification

> No files modified. All checks must pass before running Task 3.

- [ ] **Step 1: Confirm `DEPLOYER_PRIVATE_KEY` is set**

```bash
grep DEPLOYER_PRIVATE_KEY .env.local
```

Expected: line like `DEPLOYER_PRIVATE_KEY=0x<64 hex chars>` — NOT the zero placeholder from `.env.example`.

If it's missing or zero, add the real key to `.env.local` before continuing.

- [ ] **Step 2: Check deployer CELO balance**

The deploy runs ~8 transactions (2 deploys + 3 whitelist + 3 caps). Estimate: ~0.05 CELO total.

Check balance at `https://celoscan.io/address/<your-deployer-address>` — must have ≥ 0.1 CELO.

If balance is low, send CELO from an exchange or another wallet before continuing.

- [ ] **Step 3: Confirm contracts match tested code**

```bash
pnpm test:contracts
```

Expected: all tests pass. If any fail, fix them before deploying.

---

## Task 3: Deploy to Celo mainnet

> ⚠️ **IRREVERSIBLE** — this spends real CELO and deploys to production. Do not run unless Task 2 checks all pass.

- [ ] **Step 1: Run the mainnet deploy**

```bash
npx hardhat run scripts/deploy-mainnet.ts --network celo
```

Expected output:
```
Deployer: 0x…
Network: Celo mainnet (chainId 42220)
AgentWallet: 0x…
ShipPostPayment: 0x…
Whitelisting tokens...
  cUSD whitelisted
  USDT whitelisted
  USDC whitelisted
Setting daily spend caps ($10/day per token)...
  cUSD cap set
  USDT cap set
  USDC cap set

Wrote …/deployments/celo.json
Patched .env.local with mainnet addresses

=== DEPLOY COMPLETE ===
ShipPostPayment: 0x…
AgentWallet:     0x…
```

If a transaction reverts, read the error message. Common causes:
- Out of CELO gas → top up and rerun
- RPC timeout → rerun (script is idempotent on a fresh deploy; if contracts already deployed, redeploy is safe — just update env vars with new addresses)

- [ ] **Step 2: Verify on Celoscan**

Visit `https://celoscan.io/address/<ShipPostPayment_address>` and `https://celoscan.io/address/<AgentWallet_address>`.

Expected: both show contract creation transaction. Click "Contract" tab — ABI should be readable if auto-verified, or show bytecode if not.

- [ ] **Step 3: Commit deployment record**

```bash
git add deployments/celo.json
git commit -m "chore: deploy ShipPost contracts to Celo mainnet"
```

---

## Task 4: Wire env vars to Vercel + redeploy

- [ ] **Step 1: Confirm `.env.local` was patched correctly**

```bash
grep MAINNET .env.local
```

Expected:
```
NEXT_PUBLIC_PAYMENT_CONTRACT_MAINNET=0x<real address>
NEXT_PUBLIC_AGENT_WALLET_MAINNET=0x<real address>
```

Both must be non-zero addresses from Task 3.

- [ ] **Step 2: Add env vars to Vercel production**

```bash
vercel env add NEXT_PUBLIC_PAYMENT_CONTRACT_MAINNET production
```

When prompted, paste the `ShipPostPayment` address from `deployments/celo.json`.

```bash
vercel env add NEXT_PUBLIC_AGENT_WALLET_MAINNET production
```

When prompted, paste the `AgentWallet` address from `deployments/celo.json`.

- [ ] **Step 3: Redeploy to production**

```bash
vercel --prod
```

Expected: deployment completes, URL printed. Open it and confirm the app loads.

- [ ] **Step 4: Smoke test on mainnet**

Open the production URL in a browser (or MiniPay if available).

Check: the app connects to Celo mainnet (chainId 42220), shows cUSD/USDT/USDC balance, and the "Generate" button is enabled. You do not need to run a full paid thread — just confirm the UI initialises without errors and the contract address logged in the browser console matches `deployments/celo.json`.

- [ ] **Step 5: Final commit**

```bash
git add .env.local
git commit -m "chore: add mainnet contract addresses to env.local"
```

> Note: `.env.local` is in `.gitignore` by default. If it is, this step is a no-op — skip it.

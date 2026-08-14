# Base as a First-Class Chain — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Base mainnet (8453) a fully supported, default payment chain with gas sponsored by a paymaster, keep Celo/MiniPay working, and raise the thread price from $0.05 to $0.10 with an owner-settable price.

**Architecture:** The backend is already `chainId`-parametric and the database already keys on `chain_id`, so this is mostly (a) replacing one pinned `TARGET_CHAIN_ID` with an allowlist plus a default, (b) adding a second submit strategy in the payment hook that batches `approve + payForThread` into one EIP-5792 bundle with a sponsoring paymaster, and (c) an additive Solidity change making the price a settable variable guarded by a per-transaction `maxAmount` ceiling.

**Tech Stack:** Next.js 14 App Router, TypeScript, wagmi 2.19 / `@wagmi/core` 3.4 / viem 2.48 (EIP-5792 `sendCalls`, `waitForCallsStatus`, `getCapabilities`), Solidity 0.8.24 + OpenZeppelin 5.6, Hardhat 3.4 with `hardhat-viem`, Vitest 4, Supabase (service role), Upstash rate limiting.

**Spec:** [`docs/superpowers/specs/2026-08-14-base-first-class-chain-design.md`](../specs/2026-08-14-base-first-class-chain-design.md)

## Global Constraints

- **Price is `$0.10`**, stored on-chain as `priceUsdCents = 10`. `requiredAmount(token) = priceUsdCents * (10 ** (decimals - 2))`.
- **Base ships with USDC only.** USDT on Base is explicitly out of scope; do not add an address for it.
- **Base USDC is `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, 6 decimals, EIP-712 domain `{ name: 'USD Coin', version: '2' }`.** This value comes from our own `lib/x402/config.ts`, not an independent source — it MUST be confirmed on-chain (`symbol()`, `decimals()`) in Task 14 before any mainnet whitelist.
- **Never hardcode token decimals.** Always `IERC20Metadata(token).decimals()` on-chain, `token.decimals` off-chain.
- **Settle gates delivery.** Never move a `step_output` emit before its `settleX402Call`.
- **`threads.refund_tx_hash` is the single source of truth for payouts** — once set, never send again.
- **Payment is verified on-chain before any spend.** Never trust `amountPaidRaw` or any body field.
- **Supabase is service-role only** (`getSupabaseServer()`); there is no anon client.
- **`scripts/` and `tools/` are local-only** ops utilities — keep them out of lint/CI/deploy scope.
- **`ModeDef.id` is the on-chain `uint8`** — append-only, never renumber.
- **Commit after every task**, directly to `main` (this project is trunk-based; do not create branches or PRs).
- **Run `npx tsc --noEmit` before pushing.** Neither `pnpm test:lib` nor `pnpm build` typechecks `*.test.ts`.

---

### Task 1: Settable price with a `maxAmount` ceiling

Makes the price a state variable instead of a literal, and adds the ceiling that stops an owner price change from overcharging a user mid-signature.

**Files:**
- Modify: `contracts/ShipPostPayment.sol:26-29` (state), `:88-94` (`requiredAmount`), `:96-117` (`payForThread`)
- Test: `test/contracts/ShipPostPayment.t.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces:
  - `priceUsdCents() → uint256` (public state getter, initialised to `10`)
  - `setPrice(uint256 newPriceUsdCents)` — `onlyOwner`, emits `PriceUpdated(uint256 previous, uint256 current)`
  - `payForThread(address token, uint8 mode, uint256 maxAmount) → uint256 threadId` — **signature changed**, reverts `"PRICE_EXCEEDS_MAX"` when `requiredAmount(token) > maxAmount`
  - `requiredAmount(address token) → uint256` — unchanged signature, now derived from `priceUsdCents`

- [ ] **Step 1: Write the failing tests**

Append to `test/contracts/ShipPostPayment.t.ts`:

```ts
describe('settable price', () => {
  it('defaults to 10 cents and scales to each token decimals', async () => {
    const { viem } = await network.create();
    const [, agentWallet, treasury] = await viem.getWalletClients();
    const payment = await deployPayment(viem, agentWallet.account.address, treasury.account.address);

    const cusd = await viem.deployContract('MockERC20', ['Celo Dollar', 'cUSD', 18]);
    const usdc = await viem.deployContract('MockERC20', ['USD Coin', 'USDC', 6]);

    expect(await payment.read.priceUsdCents()).to.equal(10n);
    // $0.10 = 10 * 10^(d-2)
    expect(await payment.read.requiredAmount([cusd.address])).to.equal(10n ** 17n);
    expect(await payment.read.requiredAmount([usdc.address])).to.equal(100_000n);
  });

  it('setPrice moves requiredAmount for every decimals', async () => {
    const { viem } = await network.create();
    const [, agentWallet, treasury] = await viem.getWalletClients();
    const payment = await deployPayment(viem, agentWallet.account.address, treasury.account.address);
    const usdc = await viem.deployContract('MockERC20', ['USD Coin', 'USDC', 6]);

    await payment.write.setPrice([25n]);

    expect(await payment.read.priceUsdCents()).to.equal(25n);
    expect(await payment.read.requiredAmount([usdc.address])).to.equal(250_000n);
  });

  it('setPrice is owner-only', async () => {
    const { viem } = await network.create();
    const [, agentWallet, treasury, stranger] = await viem.getWalletClients();
    const payment = await deployPayment(viem, agentWallet.account.address, treasury.account.address);

    await expect(
      payment.write.setPrice([25n], { account: stranger.account })
    ).to.be.rejected;
  });

  it('setPrice rejects zero', async () => {
    const { viem } = await network.create();
    const [, agentWallet, treasury] = await viem.getWalletClients();
    const payment = await deployPayment(viem, agentWallet.account.address, treasury.account.address);

    await expect(payment.write.setPrice([0n])).to.be.rejected;
  });
});

describe('maxAmount ceiling', () => {
  // The race this exists to prevent: the user reads the price, the owner
  // raises it, the user's tx lands. Without the ceiling they are silently
  // charged the new price.
  it('reverts rather than overcharging when the price rose after the user read it', async () => {
    const { viem } = await network.create();
    const [, agentWallet, treasury, user] = await viem.getWalletClients();
    const usdc = await viem.deployContract('MockERC20', ['USD Coin', 'USDC', 6]);
    const payment = await deployPayment(viem, agentWallet.account.address, treasury.account.address);
    await payment.write.setAllowedToken([usdc.address, true]);
    await usdc.write.mint([user.account.address, 10_000_000n]);
    await usdc.write.approve([payment.address, 10_000_000n], { account: user.account });

    // User read $0.10 and consented to exactly that.
    const consented = await payment.read.requiredAmount([usdc.address]);
    // Owner raises the price before the user's tx lands.
    await payment.write.setPrice([100n]);

    await expect(
      payment.write.payForThread([usdc.address, 0, consented], { account: user.account })
    ).to.be.rejected;

    // And the user was not charged.
    expect(await usdc.read.balanceOf([user.account.address])).to.equal(10_000_000n);
  });

  it('accepts a maxAmount at or above the price', async () => {
    const { viem } = await network.create();
    const [, agentWallet, treasury, user] = await viem.getWalletClients();
    const usdc = await viem.deployContract('MockERC20', ['USD Coin', 'USDC', 6]);
    const payment = await deployPayment(viem, agentWallet.account.address, treasury.account.address);
    await payment.write.setAllowedToken([usdc.address, true]);
    await usdc.write.mint([user.account.address, 10_000_000n]);
    await usdc.write.approve([payment.address, 10_000_000n], { account: user.account });

    await payment.write.payForThread([usdc.address, 0, 100_000n], { account: user.account });

    expect(await usdc.read.balanceOf([user.account.address])).to.equal(9_900_000n);
  });

  it('splits 50/40/10 exactly at the new price, dust to reserve', async () => {
    const { viem } = await network.create();
    const [, agentWallet, treasury, user] = await viem.getWalletClients();
    const usdc = await viem.deployContract('MockERC20', ['USD Coin', 'USDC', 6]);
    const payment = await deployPayment(viem, agentWallet.account.address, treasury.account.address);
    await payment.write.setAllowedToken([usdc.address, true]);
    await usdc.write.mint([user.account.address, 10_000_000n]);
    await usdc.write.approve([payment.address, 10_000_000n], { account: user.account });

    await payment.write.payForThread([usdc.address, 0, 100_000n], { account: user.account });

    expect(await usdc.read.balanceOf([agentWallet.account.address])).to.equal(50_000n);
    expect(await usdc.read.balanceOf([treasury.account.address])).to.equal(40_000n);
    expect(await usdc.read.balanceOf([payment.address])).to.equal(10_000n);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx hardhat test test/contracts/ShipPostPayment.t.ts`
Expected: FAIL — `priceUsdCents is not a function`, and `payForThread` arity errors.

- [ ] **Step 3: Change the contract**

In `contracts/ShipPostPayment.sol`, add to the state block after `reserveBp` (around line 29):

```solidity
    /// @notice Thread price in whole US cents. Settable so a price change never
    /// requires a redeploy — the previous version hardcoded $0.05 in
    /// requiredAmount, which made every repricing a migration.
    uint256 public priceUsdCents = 10;
```

Add to the events block:

```solidity
    event PriceUpdated(uint256 previous, uint256 current);
```

Add next to the other owner setters (after `setTreasury`):

```solidity
    /// @notice Reprice a thread. Users are protected from a price change landing
    /// between their read and their transaction by payForThread's maxAmount.
    function setPrice(uint256 newPriceUsdCents) external onlyOwner {
        require(newPriceUsdCents > 0, "ZERO_PRICE");
        emit PriceUpdated(priceUsdCents, newPriceUsdCents);
        priceUsdCents = newPriceUsdCents;
    }
```

Replace `requiredAmount` (lines 88-94):

```solidity
    /// @notice Compute the required amount for a thread in this token, at the
    /// current price.
    function requiredAmount(address token) public view returns (uint256) {
        uint8 d = IERC20Metadata(token).decimals();
        require(d >= 2, "BAD_DECIMALS");
        return priceUsdCents * (10 ** (d - 2));
    }
```

Change the `payForThread` signature and add the ceiling check (lines 96-104):

```solidity
    /// @param maxAmount the most the caller consents to pay, in token base
    /// units. The price is settable, so without this ceiling an owner could
    /// reprice in the gap between a user reading the price and their
    /// transaction landing, and the user would pay the new price silently.
    function payForThread(address token, uint8 mode, uint256 maxAmount)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 threadId)
    {
        require(allowedTokens[token], "TOKEN_NOT_ALLOWED");
        uint256 amount = requiredAmount(token);
        require(amount <= maxAmount, "PRICE_EXCEEDS_MAX");
```

Leave the rest of `payForThread` (the transfer, split, counter and event) untouched.

- [ ] **Step 4: Fix the pre-existing tests that call the old signature**

Every existing `payForThread([token, mode])` call in `test/contracts/ShipPostPayment.t.ts` needs a third argument. Use a generous ceiling where the test is not about pricing:

```bash
# Find them:
grep -n "payForThread(\[" test/contracts/ShipPostPayment.t.ts
```

For each, add `, <ceiling>` as the third array element — e.g. `payForThread([cusd.address, 0])` becomes `payForThread([cusd.address, 0, 10n ** 18n])`. Existing tests asserting a $0.05 charge must be updated to the $0.10 amounts (cUSD `10n ** 17n`, 6-decimal `100_000n`), including the test named `accepts 0.05 cUSD, splits 50/40...` — rename it to `accepts 0.10 cUSD, splits 50/40...`.

- [ ] **Step 5: Run the full contract suite**

Run: `pnpm test:contracts`
Expected: PASS, all tests including `AgentWallet.t.ts`.

- [ ] **Step 6: Commit**

```bash
git add contracts/ShipPostPayment.sol test/contracts/ShipPostPayment.t.ts
git commit -m "feat(contracts): make the thread price settable, guarded by a maxAmount ceiling

The price was a literal in requiredAmount, so changing it meant redeploying
and migrating the reserve. It is now priceUsdCents (10 = \$0.10) with an
onlyOwner setter.

A settable price needs a consent ceiling: without maxAmount the owner could
reprice between a user reading the price and their tx landing, charging more
than the user ever saw. payForThread now reverts PRICE_EXCEEDS_MAX instead.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Refund the amount actually paid, not the current price

A settable price breaks the refund path: `getOnChainPaidAmount` reads the *live* `requiredAmount`, so a thread bought at $0.05 would refund at the current price and overdraw the reserve. The refundable amount must come from that thread's own `ThreadRequested` event.

**Files:**
- Modify: `lib/agent/orchestrator.ts:48-63` (replace `getOnChainPaidAmount`)
- Modify: `scripts/process-refund-request.ts:125-131` (call site)
- Test: `lib/agent/orchestrator.test.ts`

**Interfaces:**
- Consumes: Task 1's `ThreadRequested(user, threadId, mode, token, amount)` (unchanged event shape)
- Produces: `getOnChainPaidAmount({ chainId, payTxHash, threadId }) → Promise<bigint>` — **signature changed**; no longer takes `tokenSymbol`

- [ ] **Step 1: Write the failing test**

Append to `lib/agent/orchestrator.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { encodeEventTopics, encodeAbiParameters } from 'viem';
import { shipPostPaymentAbi } from '../contracts';

// A thread bought at $0.05 must still refund $0.05 after the price moves to
// $0.10. Reading the live requiredAmount() would refund the new price and
// overdraw the reserve — the bug a settable price introduces.
describe('getOnChainPaidAmount', () => {
  it('returns the amount from the thread ThreadRequested event, not the current price', async () => {
    const paymentAddr = '0x0dea32414e884253b51a43b19a6a8c6b8f3b1800';
    const OLD_PRICE = 50_000n; // $0.05 at 6 decimals

    const topics = encodeEventTopics({
      abi: shipPostPaymentAbi,
      eventName: 'ThreadRequested',
      args: {
        user: '0x5028000000000000000000000000000000009779',
        threadId: 100042n,
      },
    });
    const data = encodeAbiParameters(
      [{ type: 'uint8' }, { type: 'address' }, { type: 'uint256' }],
      [0, '0xcebA9300f2b948710d2653dD7B07f33A8B32118C', OLD_PRICE],
    );

    const getTransactionReceipt = vi.fn().mockResolvedValue({
      status: 'success',
      logs: [{ address: paymentAddr, topics, data }],
    });

    const amount = await getOnChainPaidAmount({
      chainId: 42220,
      payTxHash: '0xabc',
      threadId: 100042n,
      readers: { getTransactionReceipt },
    });

    expect(amount).toBe(OLD_PRICE);
  });

  it('throws when the receipt holds no ThreadRequested for that threadId', async () => {
    const getTransactionReceipt = vi.fn().mockResolvedValue({ status: 'success', logs: [] });

    await expect(
      getOnChainPaidAmount({
        chainId: 42220,
        payTxHash: '0xabc',
        threadId: 100042n,
        readers: { getTransactionReceipt },
      }),
    ).rejects.toThrow(/ThreadRequested/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/agent/orchestrator.test.ts -t getOnChainPaidAmount`
Expected: FAIL — the function does not accept `payTxHash`/`threadId`/`readers`.

- [ ] **Step 3: Rewrite `getOnChainPaidAmount`**

Replace `lib/agent/orchestrator.ts:44-63` entirely:

```ts
// Canonical refundable base: the amount this specific thread actually
// transferred, taken from its own ThreadRequested event.
//
// This deliberately does NOT read requiredAmount(token). That returns the
// price *now*, and the price is settable (ShipPostPayment.setPrice) — a thread
// bought at $0.05 would otherwise be refunded at the current price and
// overdraw the reserve. The event amount is immune to later repricing.
//
// It also is not the client-supplied amount_paid_raw in Supabase, which an
// attacker controls via the /api/generate/stream body.
export async function getOnChainPaidAmount(params: {
  chainId: number;
  payTxHash: Hex;
  threadId: bigint;
  readers?: { getTransactionReceipt: (args: { hash: Hex }) => Promise<any> };
}): Promise<bigint> {
  const contracts = getContracts(params.chainId);
  const paymentAddr = getAddress(contracts.ShipPostPayment);

  const readers =
    params.readers ??
    createPublicClient({ chain: getChain(params.chainId), transport: http() });

  const receipt = await readers.getTransactionReceipt({ hash: params.payTxHash });
  if (receipt.status !== 'success') throw new Error('payment tx did not succeed');

  for (const log of receipt.logs) {
    if (getAddress(log.address) !== paymentAddr) continue;
    try {
      const decoded = decodeEventLog({
        abi: shipPostPaymentAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName !== 'ThreadRequested') continue;
      const args = decoded.args as unknown as { threadId: bigint; amount: bigint };
      if (args.threadId !== params.threadId) continue;
      return args.amount;
    } catch {
      // not our event — continue
    }
  }
  throw new Error(`no ThreadRequested for threadId ${params.threadId} in ${params.payTxHash}`);
}
```

- [ ] **Step 4: Update the refund script call site**

In `scripts/process-refund-request.ts`, the thread row already carries the pay tx hash and on-chain thread id. Replace lines 125-131:

```ts
  // Trustless paid amount: the amount this thread's own ThreadRequested event
  // recorded. NOT requiredAmount(token) — the price is settable, so that would
  // refund today's price for a thread bought at yesterday's.
  const paidRaw = await getOnChainPaidAmount({
    chainId: request.chain_id,
    payTxHash: thread.pay_tx_hash as `0x${string}`,
    threadId: BigInt(thread.onchain_thread_id),
  });
```

Confirm the column names first:

```bash
grep -n "pay_tx_hash\|onchain_thread_id" supabase/migrations/0001_threads.sql
grep -n "select(" scripts/process-refund-request.ts
```

If the script's `select(...)` does not already fetch `pay_tx_hash` and `onchain_thread_id`, add them to it.

- [ ] **Step 5: Run the tests**

Run: `pnpm test:lib && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add lib/agent/orchestrator.ts lib/agent/orchestrator.test.ts scripts/process-refund-request.ts
git commit -m "fix(refund): take the refundable amount from the thread's own event

getOnChainPaidAmount read a live requiredAmount(token), which was correct
only while the price was immutable. Task 1 made it settable, so a thread
bought at \$0.05 would have refunded at \$0.10 and overdrawn the reserve.

The CLAUDE.md invariant (refund amount is read on-chain, never from
client-supplied fields) is preserved — only the on-chain source moves, to
the ThreadRequested event of that specific threadId.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Chain registry + chain policy

Splits "which chains exist" from "which chains we accept and which is default", and adds Base. This is the change that unpins the app from one chain.

**Files:**
- Modify: `lib/chains.ts` (add Base, remove the allowlist exports)
- Create: `lib/chainPolicy.ts`
- Delete: `lib/targetChain.ts`
- Test: `lib/chainPolicy.test.ts` (create), `lib/chains.test.ts` (modify)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `lib/chains.ts`: `getChain(chainId: number) → Chain` (now knows `base`, `baseSepolia`, `celo`, `celoSepolia`), `explorerBase(chainId?: number) → string`, `celoSepolia`
  - `lib/chainPolicy.ts`: `SUPPORTED_CHAIN_IDS: readonly number[]`, `DEFAULT_CHAIN_ID: number`, `isSupportedChain(chainId: number | undefined) → boolean`, `chainLabel(chainId: number) → string`, `isTestnet(chainId: number) → boolean`

- [ ] **Step 1: Write the failing tests**

Create `lib/chainPolicy.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// chainPolicy reads env at module load, so each case needs a fresh module.
async function loadPolicy(env: Record<string, string | undefined>) {
  const prev = { ...process.env };
  Object.assign(process.env, env);
  vi.resetModules();
  const mod = await import('./chainPolicy');
  process.env = prev;
  return mod;
}

import { vi } from 'vitest';

describe('chainPolicy', () => {
  afterEach(() => vi.resetModules());

  it('defaults to Base mainnet plus Celo mainnet', async () => {
    const p = await loadPolicy({
      NEXT_PUBLIC_SUPPORTED_CHAIN_IDS: undefined,
      NEXT_PUBLIC_DEFAULT_CHAIN_ID: undefined,
    });
    expect(p.DEFAULT_CHAIN_ID).toBe(8453);
    expect([...p.SUPPORTED_CHAIN_IDS].sort()).toEqual([8453, 42220]);
  });

  it('reads an explicit allowlist from env', async () => {
    const p = await loadPolicy({
      NEXT_PUBLIC_SUPPORTED_CHAIN_IDS: '84532,11142220',
      NEXT_PUBLIC_DEFAULT_CHAIN_ID: '84532',
    });
    expect([...p.SUPPORTED_CHAIN_IDS].sort()).toEqual([11142220, 84532]);
    expect(p.DEFAULT_CHAIN_ID).toBe(84532);
  });

  it('rejects unsupported and undefined chains', async () => {
    const p = await loadPolicy({ NEXT_PUBLIC_SUPPORTED_CHAIN_IDS: '8453' });
    expect(p.isSupportedChain(8453)).toBe(true);
    expect(p.isSupportedChain(1)).toBe(false);
    expect(p.isSupportedChain(undefined)).toBe(false);
    expect(p.isSupportedChain(NaN)).toBe(false);
  });

  it('falls back to the default when the env default is not in the allowlist', async () => {
    const p = await loadPolicy({
      NEXT_PUBLIC_SUPPORTED_CHAIN_IDS: '42220',
      NEXT_PUBLIC_DEFAULT_CHAIN_ID: '8453',
    });
    // A default outside the allowlist would strand every user on an
    // unsupported chain, so the allowlist wins.
    expect(p.DEFAULT_CHAIN_ID).toBe(42220);
  });

  it('labels and flags testnets', async () => {
    const p = await loadPolicy({ NEXT_PUBLIC_SUPPORTED_CHAIN_IDS: '8453,42220,84532,11142220' });
    expect(p.chainLabel(8453)).toBe('Base');
    expect(p.chainLabel(42220)).toBe('Celo');
    expect(p.chainLabel(84532)).toBe('Base Sepolia (testnet)');
    expect(p.chainLabel(11142220)).toBe('Celo Sepolia (testnet)');
    expect(p.isTestnet(84532)).toBe(true);
    expect(p.isTestnet(8453)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/chainPolicy.test.ts`
Expected: FAIL — `Cannot find module './chainPolicy'`.

- [ ] **Step 3: Create `lib/chainPolicy.ts`**

```ts
import { celo, base, baseSepolia } from 'wagmi/chains';
import { celoSepolia } from './chains';

// Which chains this deployment accepts, and which one it prefers. Split out of
// the old lib/targetChain.ts, which assumed exactly one chain — a name that
// stops being true the moment Base and Celo both run.
const KNOWN_IDS = [base.id, celo.id, baseSepolia.id, celoSepolia.id] as const;

function parseIds(raw: string | undefined): number[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && (KNOWN_IDS as readonly number[]).includes(n));
}

const configured = parseIds(process.env.NEXT_PUBLIC_SUPPORTED_CHAIN_IDS);

export const SUPPORTED_CHAIN_IDS: readonly number[] =
  configured.length > 0 ? configured : [base.id, celo.id];

const rawDefault = Number(process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID);

// A default outside the allowlist would strand every user on a chain we reject,
// so the allowlist wins over the env default.
export const DEFAULT_CHAIN_ID: number = SUPPORTED_CHAIN_IDS.includes(rawDefault)
  ? rawDefault
  : (SUPPORTED_CHAIN_IDS[0] as number);

export function isSupportedChain(chainId: number | undefined): boolean {
  if (chainId === undefined || !Number.isInteger(chainId)) return false;
  return SUPPORTED_CHAIN_IDS.includes(chainId);
}

export function isTestnet(chainId: number): boolean {
  return chainId === baseSepolia.id || chainId === celoSepolia.id;
}

export function chainLabel(chainId: number): string {
  switch (chainId) {
    case base.id:
      return 'Base';
    case celo.id:
      return 'Celo';
    case baseSepolia.id:
      return 'Base Sepolia (testnet)';
    case celoSepolia.id:
      return 'Celo Sepolia (testnet)';
    default:
      return `chain ${chainId}`;
  }
}

// MiniPay runs only on Celo and exposes NO wallet_switchEthereumChain — its
// chain comes from the wallet's own "Use Testnet" toggle, never from the dapp.
// Kept from lib/targetChain.ts so the MiniPay guidance in the UI survives.
export function isMiniPayChain(chainId: number): boolean {
  return chainId === celo.id || chainId === celoSepolia.id;
}
```

- [ ] **Step 4: Add Base to the registry and drop the duplicate allowlist**

In `lib/chains.ts`, change the import and `getChain`, and delete `SUPPORTED_CHAIN_IDS` / `isSupportedChain` (they now live in `chainPolicy`, and two sources of truth for "supported" is exactly how a chain gets accepted in one layer and rejected in another):

```ts
import { celo, base, baseSepolia } from 'wagmi/chains';
import { defineChain } from 'viem';

export const celoSepolia = defineChain({
  id: 11142220,
  name: 'Celo Sepolia',
  nativeCurrency: { name: 'CELO', symbol: 'CELO', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://forno.celo-sepolia.celo-testnet.org'] },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://celo-sepolia.blockscout.com' },
  },
  testnet: true,
});

export function getChain(chainId: number) {
  if (chainId === base.id) return base;
  if (chainId === baseSepolia.id) return baseSepolia;
  if (chainId === celo.id) return celo;
  if (chainId === celoSepolia.id) return celoSepolia;
  throw new Error(`Unsupported chain ${chainId}`);
}

export function explorerBase(chainId: number | undefined): string {
  if (chainId === base.id) return 'https://basescan.org';
  if (chainId === baseSepolia.id) return 'https://sepolia.basescan.org';
  if (chainId === celo.id) return 'https://celoscan.io';
  return 'https://celo-sepolia.blockscout.com';
}
```

Then remove the now-unused import in `lib/usePayForThread.ts:16` (`isSupportedChain` is imported there but never used — Task 7 re-adds it from `chainPolicy`):

```bash
grep -n "isSupportedChain" lib/usePayForThread.ts
```

Update `lib/chains.test.ts` for the new `getChain`/`explorerBase` cases and delete any assertions about the removed exports.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run lib/chainPolicy.test.ts lib/chains.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/chainPolicy.ts lib/chainPolicy.test.ts lib/chains.ts lib/chains.test.ts lib/usePayForThread.ts
git commit -m "feat(chains): add Base and split the registry from the chain policy

lib/targetChain.ts pinned the app to one chain, which stops being a true
name once Base and Celo both run. Which chains exist (lib/chains.ts) is now
separate from which we accept and which is default (lib/chainPolicy.ts).

The allowlist lives in exactly one place: chains.ts lost its own
SUPPORTED_CHAIN_IDS/isSupportedChain, since two sources of truth for
'supported' is how a chain gets accepted in one layer and rejected in
another.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Base tokens and contract addresses

Adds Base's token map. Because Base has no cUSD, `getTokens` stops returning every symbol, and its callers must handle a missing one.

**Files:**
- Modify: `lib/tokens.ts`
- Modify: `lib/contracts.ts` (Base entry + updated `payForThread` ABI)
- Modify: `lib/agent/orchestrator.ts:24,55,180`, `lib/agent/walletHealth.ts:139` (missing-token guards)
- Test: `lib/tokens.test.ts`

**Interfaces:**
- Consumes: Task 3's `getChain`
- Produces:
  - `getTokens(chainId: number) → Partial<Record<TokenSymbol, TokenConfig>>` — **return type changed**
  - `BASE_MAINNET_TOKENS`, `BASE_SEPOLIA_TOKENS`
  - `THREAD_PRICE_USD = 0.1`
  - `lib/contracts.ts`: `shipPostPaymentAbi` with `payForThread(address,uint8,uint256)`, `priceUsdCents`, `setPrice`, `PriceUpdated`

- [ ] **Step 1: Write the failing tests**

Append to `lib/tokens.test.ts`:

```ts
import { base } from 'wagmi/chains';
import { getTokens, computeTokenAmount, THREAD_PRICE_USD } from './tokens';

describe('Base tokens', () => {
  it('exposes USDC on Base at 6 decimals', () => {
    const t = getTokens(base.id);
    expect(t.USDC?.address).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    expect(t.USDC?.decimals).toBe(6);
  });

  it('has no cUSD on Base — the symbol simply does not exist there', () => {
    expect(getTokens(base.id).cUSD).toBeUndefined();
  });

  it('does not ship USDT on Base yet', () => {
    expect(getTokens(base.id).USDT).toBeUndefined();
  });
});

describe('thread price', () => {
  it('is $0.10', () => {
    expect(THREAD_PRICE_USD).toBe(0.1);
  });

  it('scales to 6 decimals (0.10 = 100000)', () => {
    expect(computeTokenAmount(getTokens(base.id).USDC!)).toBe(100_000n);
  });

  it('scales to 18 decimals (0.10 = 1e17)', () => {
    expect(computeTokenAmount(getTokens(42220).cUSD!)).toBe(100_000_000_000_000_000n);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/tokens.test.ts`
Expected: FAIL — `Unsupported chain: 8453`.

- [ ] **Step 3: Add the Base token maps**

In `lib/tokens.ts`, import `base`/`baseSepolia` from `wagmi/chains` and add:

```ts
// Base mainnet. USDC only for now: USDT on Base is deliberately out of scope
// until its address is verified on-chain — an unverified token address reaching
// setAllowedToken on mainnet is the expensive class of mistake.
export const BASE_MAINNET_TOKENS: Partial<Record<TokenSymbol, TokenConfig>> = {
  USDC: {
    symbol: 'USDC',
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    decimals: 6,
    displayName: 'USD Coin',
  },
};

// Base Sepolia — Circle's testnet USDC, used for the step-3 dry run.
export const BASE_SEPOLIA_TOKENS: Partial<Record<TokenSymbol, TokenConfig>> = {
  USDC: {
    symbol: 'USDC',
    address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    decimals: 6,
    displayName: 'USD Coin',
  },
};
```

Change `getTokens` and the price:

```ts
export function getTokens(chainId: number): Partial<Record<TokenSymbol, TokenConfig>> {
  if (chainId === base.id) return BASE_MAINNET_TOKENS;
  if (chainId === baseSepolia.id) return BASE_SEPOLIA_TOKENS;
  if (chainId === celo.id) return CELO_MAINNET_TOKENS;
  if (chainId === celoSepolia.id) return CELO_SEPOLIA_TOKENS;
  throw new Error(`Unsupported chain: ${chainId}`);
}

// Display/fallback only. The authoritative price is requiredAmount(token) read
// from the contract (see lib/threadPrice.ts) — the on-chain price is settable,
// so anything computed locally can be stale.
export const THREAD_PRICE_USD = 0.1;

export function computeTokenAmount(token: TokenConfig): bigint {
  return parseUnits(String(THREAD_PRICE_USD), token.decimals);
}
```

- [ ] **Step 4: Guard the call sites that index `getTokens`**

`getTokens(...)[symbol]` is now `TokenConfig | undefined`. At `lib/agent/orchestrator.ts:24`, `:55`, `:180` and `lib/agent/walletHealth.ts:139`, add a guard immediately after each lookup:

```ts
  const token = getTokens(params.chainId)[params.tokenSymbol];
  if (!token) {
    throw new Error(`token ${params.tokenSymbol} not configured for chain ${params.chainId}`);
  }
```

`lib/useBalances.ts:21` iterates the map rather than indexing it, so it needs no guard — but confirm with `npx tsc --noEmit`.

- [ ] **Step 5: Update the ABI**

In `lib/contracts.ts`, in `shipPostPaymentAbi`:

- change the `payForThread` entry's inputs to `[{ name: 'token', type: 'address' }, { name: 'mode', type: 'uint8' }, { name: 'maxAmount', type: 'uint256' }]`
- add `{ inputs: [], name: 'priceUsdCents', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' }`
- add `{ inputs: [{ internalType: 'uint256', name: 'newPriceUsdCents', type: 'uint256' }], name: 'setPrice', outputs: [], stateMutability: 'nonpayable', type: 'function' }`
- add `{ anonymous: false, inputs: [{ indexed: false, internalType: 'uint256', name: 'previous', type: 'uint256' }, { indexed: false, internalType: 'uint256', name: 'current', type: 'uint256' }], name: 'PriceUpdated', type: 'event' }`

Add the Base entry to `CONTRACTS` with placeholder-free intent — the addresses do not exist until Task 14, so read them from env with no fallback and let a missing value fail loudly:

```ts
  [base.id]: {
    ShipPostPayment: process.env.NEXT_PUBLIC_PAYMENT_CONTRACT_BASE as Address,
    AgentWallet: process.env.NEXT_PUBLIC_AGENT_WALLET_BASE as Address,
  },
```

- [ ] **Step 6: Run the tests**

Run: `pnpm test:lib && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/tokens.ts lib/tokens.test.ts lib/contracts.ts lib/agent/orchestrator.ts lib/agent/walletHealth.ts
git commit -m "feat(tokens): add Base USDC, raise the price to \$0.10, widen the ABI

Base has no cUSD, so getTokens returns a partial map and its callers now
handle a missing symbol instead of assuming all three exist.

USDT on Base is deliberately absent: its address was not verified this
session, and an unverified address reaching setAllowedToken on mainnet is
the expensive mistake. Adding it later is one map entry.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Reject unsupported chains with 400, before any work

`body.chainId` is attacker-controlled and today only survives because `getContracts()` throws — a 500, after the route has already started. With two chains live this needs to be an explicit allowlist.

**Files:**
- Modify: `app/api/generate/stream/route.ts:69-80` (`validate`)
- Modify: `app/api/refund/route.ts:21`
- Test: `app/api/generate/stream/route.test.ts`

**Interfaces:**
- Consumes: Task 3's `isSupportedChain`
- Produces: no new exports; both routes return `400` with body `unsupported chainId` for a chain outside the allowlist

- [ ] **Step 1: Write the failing test**

Append to `app/api/generate/stream/route.test.ts`:

```ts
// body.chainId is fully attacker-controlled. An unknown chain must be turned
// away by an explicit allowlist, before any Supabase query, RPC call or paid
// work — not incidentally, by getContracts() throwing a 500 further in.
it('rejects an unsupported chainId with 400 and does no work', async () => {
  const res = await POST(
    new Request('http://localhost/api/generate/stream', {
      method: 'POST',
      body: JSON.stringify({
        threadId: '1',
        chainId: 1, // Ethereum mainnet — not supported
        walletAddress: '0x5028000000000000000000000000000000009779',
        tokenSymbol: 'USDC',
        tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        amountPaidRaw: '100000',
        payTxHash: '0xdeadbeef',
        mode: 0,
        topic: 'test',
      }),
    }),
  );

  expect(res.status).toBe(400);
  expect(await res.text()).toContain('unsupported chainId');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run app/api/generate/stream/route.test.ts -t "unsupported chainId"`
Expected: FAIL — status is 402 or 500, not 400.

- [ ] **Step 3: Add the allowlist check**

In `app/api/generate/stream/route.ts`, import `isSupportedChain` from `@/lib/chainPolicy` and add to `validate` immediately after the `chainId required` line:

```ts
  if (!b.chainId) return 'chainId required';
  // Explicit allowlist. Relying on getContracts() to throw made an unsupported
  // chain a 500 raised partway through the route; it must be a 400 raised
  // before anything happens.
  if (!isSupportedChain(b.chainId)) return 'unsupported chainId';
```

Apply the same two lines in `app/api/refund/route.ts` after its `chainId required` check at line 21.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run app/api/generate/stream/route.test.ts app/api/refund`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/generate/stream/route.ts app/api/generate/stream/route.test.ts app/api/refund/route.ts
git commit -m "fix(api): allowlist body.chainId with a 400 instead of an incidental 500

chainId is attacker-controlled and was only rejected as a side effect of
getContracts() throwing, partway through the route. With two chains live it
gets an explicit allowlist check, before any Supabase query or RPC call.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Attribution tag only on Celo

The ERC-8021 suffix credits Celo reward programs. On Base it is calldata no program reads — harmless to the EVM, but it makes transactions look tagged for a program they cannot enter.

**Files:**
- Modify: `lib/attributionTag.ts:74-81`
- Modify: `lib/usePayForThread.ts` (both `dataSuffix` call sites)
- Test: `lib/attributionTag.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `getAttributionSuffix(chainId: number) → Hex | undefined` — **signature changed**, returns `undefined` for any non-Celo chain

- [ ] **Step 1: Write the failing test**

Append to `lib/attributionTag.test.ts`:

```ts
import { base, celo } from 'wagmi/chains';

describe('chain scoping', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://shippost-kappa.vercel.app';
    resetAttributionSuffixCache();
  });

  it('tags Celo transactions', () => {
    expect(getAttributionSuffix(celo.id)).toMatch(/^0x/);
  });

  it('does not tag Base transactions — no Celo program reads them', () => {
    expect(getAttributionSuffix(base.id)).toBeUndefined();
  });

  it('tags Celo Sepolia too', () => {
    expect(getAttributionSuffix(11142220)).toMatch(/^0x/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/attributionTag.test.ts -t "chain scoping"`
Expected: FAIL — Base returns a suffix.

- [ ] **Step 3: Scope the suffix by chain**

In `lib/attributionTag.ts`, replace `getAttributionSuffix`:

```ts
import { isMiniPayChain } from './chainPolicy';

/**
 * The ERC-8021 suffix to pass as `dataSuffix`, or `undefined` when this chain
 * has no attribution program or no tag is configured.
 *
 * Celo-only by design: the codes are issued by Celo's reward programs, so on
 * Base the suffix is calldata nothing reads. The EVM discards it either way,
 * but emitting it there would misrepresent those transactions as tagged for a
 * program they cannot enter.
 *
 * Never throws. Attribution is telemetry: if it cannot be built, the
 * transaction must still go out untagged rather than fail.
 */
export function getAttributionSuffix(chainId: number): Hex | undefined {
  if (!isMiniPayChain(chainId)) return undefined;
  if (cached === undefined) cached = build();
  return cached ?? undefined;
}
```

In `lib/usePayForThread.ts`, both `dataSuffix: getAttributionSuffix()` call sites become `dataSuffix: getAttributionSuffix(chainId)`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/attributionTag.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/attributionTag.ts lib/attributionTag.test.ts lib/usePayForThread.ts
git commit -m "fix(attribution): only tag Celo transactions

The ERC-8021 codes are issued by Celo's reward programs. Appending them on
Base is calldata nothing reads — harmless to the EVM, but it misrepresents
those transactions as tagged for a program they cannot enter.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Multi-chain wagmi config and the seven pinned consumers

Replaces the last of the single-chain assumption in the client.

**Files:**
- Modify: `lib/wagmi.ts`
- Modify: `app/HomeClient.tsx:44,134,954,960,970`
- Modify: `components/WalletMenu.tsx:19,98,102,320`
- Modify: `lib/usePayForThread.ts:17,103-104,158,167`
- Test: `lib/wagmi.test.ts`

**Interfaces:**
- Consumes: Task 3's `chainPolicy` exports, Task 3's `getChain`
- Produces: `wagmiConfig` with both chains registered and a transport per chain

- [ ] **Step 1: Write the failing test**

Append to `lib/wagmi.test.ts`:

```ts
import { base, celo } from 'wagmi/chains';

describe('multi-chain config', () => {
  it('registers every supported chain, default first', () => {
    const ids = wagmiConfig.chains.map((c) => c.id);
    expect(ids).toContain(base.id);
    expect(ids).toContain(celo.id);
    expect(ids[0]).toBe(DEFAULT_CHAIN_ID);
  });

  it('has a transport for every registered chain', () => {
    for (const c of wagmiConfig.chains) {
      expect(wagmiConfig._internal.transports[c.id]).toBeDefined();
    }
  });

  it('keeps the injected connector first so MiniPay auto-connect still attaches', () => {
    const ids = wagmiConfig.connectors.map((c) => c.id);
    expect(ids).toContain('injected');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/wagmi.test.ts -t "multi-chain config"`
Expected: FAIL — only one chain registered.

- [ ] **Step 3: Rewrite the wagmi config**

Replace the config block in `lib/wagmi.ts`:

```ts
import { http } from 'wagmi';
import { celo, base, baseSepolia } from 'wagmi/chains';
import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import {
  injectedWallet,
  safeWallet,
  rainbowWallet,
  base as baseWallet,
  metaMaskWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { celoSepolia, getChain } from './chains';
import { SUPPORTED_CHAIN_IDS, DEFAULT_CHAIN_ID } from './chainPolicy';

export { celoSepolia };

const projectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'coinop-placeholder';

const RPC: Record<number, string> = {
  [base.id]: 'https://mainnet.base.org',
  [baseSepolia.id]: 'https://sepolia.base.org',
  [celo.id]: 'https://forno.celo.org',
  [celoSepolia.id]: 'https://forno.celo-sepolia.celo-testnet.org',
};

// Default chain first: wagmi treats chains[0] as the one to connect to when the
// wallet offers no opinion.
const orderedIds = [
  DEFAULT_CHAIN_ID,
  ...SUPPORTED_CHAIN_IDS.filter((id) => id !== DEFAULT_CHAIN_ID),
];
const chains = orderedIds.map(getChain) as [ReturnType<typeof getChain>, ...ReturnType<typeof getChain>[]];

export const wagmiConfig = getDefaultConfig({
  appName: 'CoinOp',
  projectId,
  // MiniPay only surfaces window.ethereum (no EIP-6963), so the injected
  // connector must be configured explicitly — RainbowKit's default wallet
  // list omits it, leaving auto-connect nothing to attach to. Keep it first;
  // HomeClient auto-connect looks it up by id 'injected'.
  wallets: [
    {
      groupName: 'Popular',
      wallets: [injectedWallet, safeWallet, rainbowWallet, baseWallet, metaMaskWallet, walletConnectWallet],
    },
  ],
  chains,
  transports: Object.fromEntries(orderedIds.map((id) => [id, http(RPC[id])])),
  ssr: true,
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
```

- [ ] **Step 4: Update the consumers**

Mechanical, one pattern:

- `app/HomeClient.tsx:44` — import `{ isSupportedChain, chainLabel, isTestnet, isMiniPayChain }` from `@/lib/chainPolicy` instead of `@/lib/targetChain`.
- `app/HomeClient.tsx:134` — `const onSupportedChain = isSupportedChain(chainId);`
- `app/HomeClient.tsx:954` — `CoinOp runs on {SUPPORTED_CHAIN_IDS.map(chainLabel).join(' or ')}.`
- `app/HomeClient.tsx:960` — the MiniPay testnet-toggle hint now keys on `isMiniPayChain(chainId) && isTestnet(chainId)`.
- `app/HomeClient.tsx:970` — `Use the wallet button above to switch to {chainLabel(DEFAULT_CHAIN_ID)}.`
- `components/WalletMenu.tsx:98` — `const switchToDefault = () => switchChain({ chainId: DEFAULT_CHAIN_ID });`
- `components/WalletMenu.tsx:102` — `const isOnSupportedChain = isSupportedChain(chainId);`
- `components/WalletMenu.tsx:320` — `Switch to {chainLabel(DEFAULT_CHAIN_ID)}`
- `lib/usePayForThread.ts:103-104` — `if (!isSupportedChain(chainId)) { fail('setup', \`Wrong network. Switch your wallet to ${chainLabel(DEFAULT_CHAIN_ID)}.\`); return; }`
- `lib/usePayForThread.ts:158,167` — replace `targetChainName()`/`TARGET_CHAIN_ID` in the messages with `chainLabel(chainId)` and `chainId`.

**Do not offer `switchChain` when `isMiniPayChain(chainId)` is true** — MiniPay exposes no `wallet_switchEthereumChain` and the call silently fails.

Then delete the dead file:

```bash
git rm lib/targetChain.ts
grep -rn "targetChain" --include="*.ts" --include="*.tsx" app components hooks lib   # must be empty
```

- [ ] **Step 5: Run the tests**

Run: `pnpm test:lib && npx tsc --noEmit && pnpm build`
Expected: PASS on all three.

- [ ] **Step 6: Commit**

```bash
git add -u && git add lib/wagmi.ts lib/wagmi.test.ts
git commit -m "feat(wallet): register both chains and drop lib/targetChain.ts

The seven consumers move from 'is the wallet on THE chain' to 'is the wallet
on A supported chain'. switchChain stays suppressed on MiniPay, which exposes
no wallet_switchEthereumChain.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Read the price from the chain instead of computing it

With `setPrice` live, a locally computed price can be stale. The approve amount, the `maxAmount` ceiling and the displayed price must all come from one on-chain read.

**Files:**
- Create: `lib/threadPrice.ts`
- Test: `lib/threadPrice.test.ts`

**Interfaces:**
- Consumes: Task 4's `shipPostPaymentAbi`, `getContracts`, `TokenConfig`
- Produces: `readThreadPrice({ publicClient, chainId, token }) → Promise<bigint>`

- [ ] **Step 1: Write the failing test**

Create `lib/threadPrice.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { readThreadPrice } from './threadPrice';

describe('readThreadPrice', () => {
  it('returns requiredAmount from the contract', async () => {
    const readContract = vi.fn().mockResolvedValue(100_000n);
    const token = { symbol: 'USDC', address: '0x8335', decimals: 6, displayName: 'USD Coin' } as any;

    const price = await readThreadPrice({
      publicClient: { readContract } as any,
      chainId: 8453,
      token,
    });

    expect(price).toBe(100_000n);
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'requiredAmount', args: [token.address] }),
    );
  });

  // The on-chain price is authoritative; a local constant only ever drifts.
  it('does not fall back to the local constant when the read fails', async () => {
    const readContract = vi.fn().mockRejectedValue(new Error('rpc down'));
    const token = { symbol: 'USDC', address: '0x8335', decimals: 6, displayName: 'USD Coin' } as any;

    await expect(
      readThreadPrice({ publicClient: { readContract } as any, chainId: 8453, token }),
    ).rejects.toThrow(/rpc down/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/threadPrice.test.ts`
Expected: FAIL — `Cannot find module './threadPrice'`.

- [ ] **Step 3: Create `lib/threadPrice.ts`**

```ts
import type { PublicClient } from 'viem';
import { getContracts, shipPostPaymentAbi } from './contracts';
import type { TokenConfig } from './tokens';

/**
 * The authoritative thread price, in this token's base units.
 *
 * The contract price is settable (ShipPostPayment.setPrice), so anything
 * computed client-side from THREAD_PRICE_USD can be stale. The approve amount,
 * the maxAmount ceiling and the price shown to the user all derive from this
 * single read, so they cannot disagree with each other or with the chain.
 *
 * Deliberately does NOT fall back to the local constant on failure: paying a
 * guessed price is worse than not paying. If the price cannot be read, the
 * caller should surface the error rather than sign something unverified.
 */
export async function readThreadPrice(params: {
  publicClient: PublicClient;
  chainId: number;
  token: TokenConfig;
}): Promise<bigint> {
  const contracts = getContracts(params.chainId);
  return (await params.publicClient.readContract({
    address: contracts.ShipPostPayment,
    abi: shipPostPaymentAbi,
    functionName: 'requiredAmount',
    args: [params.token.address],
  })) as bigint;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/threadPrice.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/threadPrice.ts lib/threadPrice.test.ts
git commit -m "feat(price): read the thread price from the contract

setPrice makes any locally computed price potentially stale. One read now
feeds the approve amount, the maxAmount ceiling and the displayed price, so
those three cannot disagree.

It deliberately does not fall back to THREAD_PRICE_USD on failure — paying a
guessed price is worse than not paying.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: The pay-bundle builder

A pure function, so the batching logic is testable without a wallet.

**Files:**
- Create: `lib/payBundle.ts`
- Test: `lib/payBundle.test.ts`

**Interfaces:**
- Consumes: Task 4's `shipPostPaymentAbi`, `TokenConfig`
- Produces: `buildPayCalls({ token, paymentAddr, price, mode, needsApprove, approveBatch }) → PayCall[]` where `PayCall = { to: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] }`

- [ ] **Step 1: Write the failing test**

Create `lib/payBundle.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildPayCalls } from './payBundle';

const token = {
  symbol: 'USDC' as const,
  address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const,
  decimals: 6,
  displayName: 'USD Coin',
};
const paymentAddr = '0x0dea32414e884253b51a43b19a6a8c6b8f3b1800' as const;

describe('buildPayCalls', () => {
  it('batches approve then pay when allowance is short', () => {
    const calls = buildPayCalls({
      token,
      paymentAddr,
      price: 100_000n,
      mode: 1,
      needsApprove: true,
      approveBatch: 40n,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].functionName).toBe('approve');
    expect(calls[0].to).toBe(token.address);
    expect(calls[0].args).toEqual([paymentAddr, 4_000_000n]);
    expect(calls[1].functionName).toBe('payForThread');
    expect(calls[1].to).toBe(paymentAddr);
  });

  it('omits the approve when allowance already covers the price', () => {
    const calls = buildPayCalls({
      token,
      paymentAddr,
      price: 100_000n,
      mode: 1,
      needsApprove: false,
      approveBatch: 40n,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].functionName).toBe('payForThread');
  });

  // The ceiling is the user's consent. It must be exactly the price they were
  // shown — never padded, or the padding is headroom for an unnoticed increase.
  it('sets maxAmount to exactly the price that was read', () => {
    const calls = buildPayCalls({
      token,
      paymentAddr,
      price: 100_000n,
      mode: 1,
      needsApprove: false,
      approveBatch: 40n,
    });

    expect(calls[0].args).toEqual([token.address, 1, 100_000n]);
  });

  it('approve always targets the payment contract as spender', () => {
    const calls = buildPayCalls({
      token,
      paymentAddr,
      price: 100_000n,
      mode: 0,
      needsApprove: true,
      approveBatch: 1n,
    });

    expect(calls[0].args[0]).toBe(paymentAddr);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/payBundle.test.ts`
Expected: FAIL — `Cannot find module './payBundle'`.

- [ ] **Step 3: Create `lib/payBundle.ts`**

```ts
import { erc20Abi, type Address } from 'viem';
import { shipPostPaymentAbi } from './contracts';
import type { TokenConfig } from './tokens';

export interface PayCall {
  to: Address;
  abi: readonly unknown[];
  functionName: string;
  args: readonly unknown[];
}

/**
 * The calls for one paid thread, as an EIP-5792 batch.
 *
 * Batching is not just a gas convenience: sending approve and payForThread as
 * two separate transactions leaves a gap where the approve can revert, land
 * short, or be rewritten by the wallet — the gap behind both the USDT
 * approve-receipt bug and the first-payment allowance-0 bug. In one bundle
 * there is no intermediate state to fail into.
 *
 * `price` must come from readThreadPrice, and is passed straight through as
 * maxAmount: the ceiling is the user's consent, so it is exactly the number
 * they were shown, never padded.
 */
export function buildPayCalls(params: {
  token: TokenConfig;
  paymentAddr: Address;
  price: bigint;
  mode: number;
  needsApprove: boolean;
  approveBatch: bigint;
}): PayCall[] {
  const calls: PayCall[] = [];

  if (params.needsApprove) {
    calls.push({
      to: params.token.address,
      abi: erc20Abi,
      functionName: 'approve',
      args: [params.paymentAddr, params.price * params.approveBatch],
    });
  }

  calls.push({
    to: params.paymentAddr,
    abi: shipPostPaymentAbi,
    functionName: 'payForThread',
    args: [params.token.address, params.mode, params.price],
  });

  return calls;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/payBundle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/payBundle.ts lib/payBundle.test.ts
git commit -m "feat(pay): add the EIP-5792 pay-bundle builder

Pure function so the batching is testable without a wallet.

Batching approve+pay is a correctness fix, not just a gas one: two separate
transactions leave a gap where the approve can revert or land short, which is
the gap behind both the USDT approve-receipt bug and the first-payment
allowance-0 bug.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: The sponsored submit strategy in `usePayForThread`

Adds the second strategy. The existing EOA sequence stays intact — it encodes hard-won knowledge and must not be rewritten.

**Files:**
- Modify: `lib/usePayForThread.ts`
- Test: `lib/usePayForThread.test.ts`

**Interfaces:**
- Consumes: Task 8's `readThreadPrice`, Task 9's `buildPayCalls`, Task 3's `chainPolicy`
- Produces: unchanged `PayResult` shape — callers in `app/HomeClient.tsx` need no change

- [ ] **Step 1: Write the failing test**

Append to `lib/usePayForThread.test.ts`:

```ts
import { resolveBundleTxHash } from './usePayForThread';

// sendCalls returns a BUNDLE ID, not a transaction hash. /api/generate/stream
// verifies payTxHash against an on-chain receipt, so posting the bundle id
// would fail verification for every sponsored payment.
describe('resolveBundleTxHash', () => {
  it('extracts the transaction hash from the settled bundle', () => {
    expect(
      resolveBundleTxHash({
        status: 'success',
        receipts: [{ transactionHash: '0xfeed', status: 'success' }],
      } as any),
    ).toBe('0xfeed');
  });

  it('takes the last receipt — payForThread is the final call in the bundle', () => {
    expect(
      resolveBundleTxHash({
        status: 'success',
        receipts: [
          { transactionHash: '0xapprove', status: 'success' },
          { transactionHash: '0xpay', status: 'success' },
        ],
      } as any),
    ).toBe('0xpay');
  });

  it('throws when the bundle produced no receipts', () => {
    expect(() => resolveBundleTxHash({ status: 'success', receipts: [] } as any)).toThrow(
      /no receipt/i,
    );
  });

  it('throws when the bundle did not succeed', () => {
    expect(() =>
      resolveBundleTxHash({ status: 'failure', receipts: [] } as any),
    ).toThrow(/bundle/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/usePayForThread.test.ts -t resolveBundleTxHash`
Expected: FAIL — `resolveBundleTxHash` is not exported.

- [ ] **Step 3: Add the helper and the strategy**

In `lib/usePayForThread.ts`, add imports and the exported helper:

```ts
import { sendCalls, waitForCallsStatus, getCapabilities } from '@wagmi/core';
import { useConfig } from 'wagmi';
import { readThreadPrice } from './threadPrice';
import { buildPayCalls } from './payBundle';
import type { WaitForCallsStatusReturnType } from '@wagmi/core';

/**
 * The real transaction hash behind a settled EIP-5792 bundle.
 *
 * sendCalls hands back a bundle id, but /api/generate/stream verifies
 * payTxHash against an on-chain receipt — posting the bundle id would fail
 * verification for every sponsored payment. The last receipt is payForThread,
 * which is the call that emits ThreadRequested.
 */
export function resolveBundleTxHash(status: WaitForCallsStatusReturnType): Hex {
  if (status.status !== 'success') {
    throw new Error(`Payment bundle did not succeed (${status.status})`);
  }
  const last = status.receipts?.[status.receipts.length - 1];
  if (!last?.transactionHash) throw new Error('Payment bundle produced no receipt');
  return last.transactionHash as Hex;
}
```

Inside the hook, add `const config = useConfig();` and, at the top of the `try` in `pay` (after `paymentAddr` is resolved), branch:

```ts
        // Authoritative price: one read feeds the approve amount, the consent
        // ceiling and the displayed price.
        const price = await readThreadPrice({ publicClient, chainId, token });

        const allowance = await publicClient.readContract({
          address: token.address,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [address, paymentAddr],
        });
        const needsApprove = allowance < price;

        let sponsored = false;
        try {
          const caps = await getCapabilities(config, { account: address, chainId });
          sponsored = caps?.paymasterService?.supported === true;
        } catch {
          // A wallet that cannot answer wallet_getCapabilities is simply an EOA
          // wallet. Fall through to the unsponsored path rather than failing.
          sponsored = false;
        }

        if (sponsored) {
          phase = 'pay';
          setStatus('paying');
          haptic('tap');

          const calls = buildPayCalls({
            token,
            paymentAddr,
            price,
            mode,
            needsApprove,
            approveBatch: APPROVE_BATCH,
          });

          const { id } = await sendCalls(config, {
            account: address,
            chainId,
            calls,
            capabilities: {
              paymasterService: {
                url: '/api/paymaster',
                // If the paymaster declines or is out of quota, the wallet
                // still submits the bundle with the user paying gas, instead
                // of failing the payment outright.
                optional: true,
              },
            },
          });

          phase = 'confirm';
          setStatus('waiting-confirmation');
          const settled = await waitForCallsStatus(config, { id });
          const payHash = resolveBundleTxHash(settled);
          setTxHash(payHash);

          const receipt = await publicClient.getTransactionReceipt({ hash: payHash });
          const bundledId = extractThreadId(receipt.logs);
          if (bundledId === null) {
            throw new Error('Payment confirmed but ThreadRequested event not found in receipt');
          }
          setThreadId(bundledId);
          setStatus('success');
          haptic('success');
          return;
        }

        // Unsponsored path below — unchanged.
        const amount = price;
```

Then in the existing EOA path, replace `computeTokenAmount(token)` with the `price` read above, replace the recomputed `allowance` read with `needsApprove`, and add the ceiling to the pay call:

```ts
          args: [token.address, mode, price],
```

**Do not restructure the existing approve-receipt check or the wallet-chain resync loop.** They stay exactly as they are.

- [ ] **Step 4: Run the tests**

Run: `pnpm test:lib && npx tsc --noEmit && pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/usePayForThread.ts lib/usePayForThread.test.ts
git commit -m "feat(pay): sponsor gas via EIP-5792 when the wallet supports it

Wallets reporting paymasterService support send approve+payForThread as one
sponsored bundle; everything else keeps the existing EOA path untouched.

Two details that break the flow silently if missed: sendCalls returns a
bundle id rather than a tx hash, and /api/generate/stream verifies a real
receipt — hence resolveBundleTxHash. And paymasterService.optional keeps a
declining paymaster from failing the payment outright.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: `/api/paymaster` — a guarded proxy

Without an allowlist this endpoint sponsors arbitrary transactions for anyone who finds it.

**Files:**
- Create: `app/api/paymaster/route.ts`
- Test: `app/api/paymaster/route.test.ts`

**Interfaces:**
- Consumes: Task 4's `getContracts`, `getTokens`; `CDP_PAYMASTER_URL` env
- Produces: `POST /api/paymaster` — JSON-RPC proxy accepting only `pm_getPaymasterStubData` and `pm_getPaymasterData`

- [ ] **Step 1: Write the failing test**

Create `app/api/paymaster/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

const PAYMENT = '0x0dea32414e884253b51a43b19a6a8c6b8f3b1800';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const ATTACKER = '0x000000000000000000000000000000000000dead';

function rpc(method: string, to: string, data = '0x') {
  return new Request('http://localhost/api/paymaster', {
    method: 'POST',
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params: [{ callData: data, to }, '0x', '0x2105'],
    }),
  });
}

beforeEach(() => {
  process.env.CDP_PAYMASTER_URL = 'https://paymaster.example/rpc';
  process.env.NEXT_PUBLIC_PAYMENT_CONTRACT_BASE = PAYMENT;
  vi.restoreAllMocks();
});

describe('/api/paymaster', () => {
  it('rejects an unknown JSON-RPC method', async () => {
    const res = await POST(rpc('eth_sendTransaction', PAYMENT));
    expect(res.status).toBe(400);
  });

  // Without this the endpoint is a public wallet: anyone who finds it can have
  // their own transactions sponsored.
  it('refuses to sponsor a call to any contract but ours', async () => {
    const res = await POST(rpc('pm_getPaymasterData', ATTACKER));
    expect(res.status).toBe(403);
  });

  it('refuses an approve whose spender is not the payment contract', async () => {
    // approve(attacker, 1) — selector 0x095ea7b3
    const data = `0x095ea7b3${ATTACKER.slice(2).padStart(64, '0')}${'1'.padStart(64, '0')}`;
    const res = await POST(rpc('pm_getPaymasterData', USDC, data));
    expect(res.status).toBe(403);
  });

  it('allows an approve whose spender is the payment contract', async () => {
    const data = `0x095ea7b3${PAYMENT.slice(2).padStart(64, '0')}${'1'.padStart(64, '0')}`;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })));

    const res = await POST(rpc('pm_getPaymasterData', USDC, data));

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://paymaster.example/rpc',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('refuses a chain other than Base mainnet', async () => {
    const req = new Request('http://localhost/api/paymaster', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'pm_getPaymasterData',
        params: [{ callData: '0x', to: PAYMENT }, '0x', '0x1'], // chain 1
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('never leaks the upstream paymaster URL', async () => {
    const res = await POST(rpc('pm_getPaymasterData', ATTACKER));
    expect(await res.text()).not.toContain('paymaster.example');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run app/api/paymaster/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Create the route**

```ts
import { NextResponse } from 'next/server';
import { getAddress, type Address } from 'viem';
import { base } from 'wagmi/chains';
import { getContracts } from '@/lib/contracts';
import { getTokens } from '@/lib/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Only the two methods a wallet needs to obtain sponsorship. Anything else —
// including eth_* — is refused: this is a paymaster proxy, not an RPC.
const ALLOWED_METHODS = new Set(['pm_getPaymasterStubData', 'pm_getPaymasterData']);

const APPROVE_SELECTOR = '0x095ea7b3';

function spenderFromApprove(callData: string): Address | null {
  if (!callData.startsWith(APPROVE_SELECTOR)) return null;
  const word = callData.slice(10, 74);
  if (word.length < 64) return null;
  try {
    return getAddress(`0x${word.slice(24)}`);
  } catch {
    return null;
  }
}

/**
 * Sponsorship proxy. The CDP paymaster URL is a secret and never reaches the
 * client, and every request is checked against an allowlist first.
 *
 * Without the allowlist this endpoint is a public wallet: any transaction sent
 * through it would have its gas paid by us. The checks are therefore
 * deny-by-default — an unrecognised target, selector or chain is refused, not
 * forwarded.
 */
export async function POST(req: Request) {
  const upstream = process.env.CDP_PAYMASTER_URL;
  if (!upstream) {
    return NextResponse.json({ error: 'sponsorship unavailable' }, { status: 503 });
  }

  let body: { method?: string; params?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  if (!body.method || !ALLOWED_METHODS.has(body.method)) {
    return NextResponse.json({ error: 'method not allowed' }, { status: 400 });
  }

  const userOp = body.params?.[0] as { to?: string; callData?: string } | undefined;
  const chainHex = body.params?.[2] as string | undefined;

  if (!chainHex || Number(chainHex) !== base.id) {
    return NextResponse.json({ error: 'chain not sponsored' }, { status: 403 });
  }
  if (!userOp?.to) {
    return NextResponse.json({ error: 'missing target' }, { status: 403 });
  }

  let payment: Address;
  try {
    payment = getAddress(getContracts(base.id).ShipPostPayment);
  } catch {
    return NextResponse.json({ error: 'sponsorship unavailable' }, { status: 503 });
  }

  let target: Address;
  try {
    target = getAddress(userOp.to);
  } catch {
    return NextResponse.json({ error: 'bad target' }, { status: 403 });
  }

  const allowed =
    target === payment ||
    // An approve is only sponsored when the spender is our payment contract:
    // sponsoring an arbitrary approve would let anyone fund token approvals to
    // an address of their choosing.
    (Object.values(getTokens(base.id)).some((t) => t && getAddress(t.address) === target) &&
      spenderFromApprove(userOp.callData ?? '') === payment);

  if (!allowed) {
    return NextResponse.json({ error: 'target not sponsored' }, { status: 403 });
  }

  const res = await fetch(upstream, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  // Pass the upstream body through verbatim, but never its URL or headers.
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { 'content-type': 'application/json' },
  });
}
```

- [ ] **Step 4: Add rate limiting**

Follow the existing pattern in `lib/rateLimit.ts` and apply it at the top of `POST`, keyed by IP, before any parsing. Check the existing usage first so the limiter is constructed the same way:

```bash
grep -rn "rateLimit" --include="*.ts" app/api | grep -v test
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run app/api/paymaster/route.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/paymaster/route.ts app/api/paymaster/route.test.ts
git commit -m "feat(paymaster): add the sponsorship proxy with a deny-by-default allowlist

The CDP paymaster URL is a secret and never reaches the client. Every request
is checked before forwarding: Base mainnet only, our payment contract only,
and an approve only when its spender is that same contract.

Without the allowlist this endpoint is a public wallet — anyone who found it
could have their gas paid by us.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Monitor every supported chain

`reconcile` and `preflight` watch one pinned chain. With two live, an unmonitored chain silently runs out of gas or reserve.

**Files:**
- Modify: `app/api/cron/reconcile/route.ts:13,57-108`
- Modify: `app/api/preflight/route.ts:3,9,34`
- Modify: `lib/agent/walletHealth.ts:106-118` (`minCelo` → `minNative`)
- Test: `app/api/cron/reconcile/route.test.ts`, `lib/agent/walletHealth.test.ts`

**Interfaces:**
- Consumes: Task 3's `SUPPORTED_CHAIN_IDS`, Task 4's `getTokens`
- Produces: `checkOrchestratorGas({ chainId, minNative?, readers? }) → Promise<GasHealth>` — **parameter renamed**

- [ ] **Step 1: Write the failing test**

Append to `app/api/cron/reconcile/route.test.ts`:

```ts
// A chain nobody watches is a chain that quietly runs out of gas or reserve.
it('checks agent wallet, gas and reserve on every supported chain', async () => {
  const seen: number[] = [];
  vi.mocked(checkAgentWalletBalance).mockImplementation(async ({ chainId }) => {
    seen.push(chainId);
    return { low: false, usd: 10, address: '0x0' } as any;
  });

  await GET(new Request('http://localhost/api/cron/reconcile', {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  }));

  expect(seen).toEqual(expect.arrayContaining([...SUPPORTED_CHAIN_IDS]));
});
```

And in `lib/agent/walletHealth.test.ts`:

```ts
it('uses minNative, since an ETH threshold is not a CELO threshold', async () => {
  const readOwner = vi.fn().mockResolvedValue('0x64ad');
  const readNativeBalance = vi.fn().mockResolvedValue(parseEther('0.001'));

  const health = await checkOrchestratorGas({
    chainId: 8453,
    minNative: 0.002,
    readers: { readOwner, readNativeBalance },
  });

  expect(health.low).toBe(true);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run app/api/cron/reconcile lib/agent/walletHealth.test.ts`
Expected: FAIL — only one chain is checked; `minNative` is not a parameter.

- [ ] **Step 3: Rename the gas parameter**

In `lib/agent/walletHealth.ts`, rename `minCelo` to `minNative` in the `checkOrchestratorGas` parameter type and body (line 108 and 116), and rename `DEFAULT_MIN_GAS_CELO` to `DEFAULT_MIN_GAS_NATIVE`. Keep the returned field name `celo` **only if** other code reads it — check first:

```bash
grep -rn "\.celo\b" --include="*.ts" --include="*.tsx" app lib components | grep -v test
```

If nothing reads it, rename the return field to `native` too and update the alert message.

- [ ] **Step 4: Loop the monitors over every chain**

In `app/api/cron/reconcile/route.ts`, replace the import of `TARGET_CHAIN_ID` with `SUPPORTED_CHAIN_IDS` from `@/lib/chainPolicy`, and wrap the three health blocks (lines 57-108) in:

```ts
  for (const chainId of SUPPORTED_CHAIN_IDS) {
    // ... existing checkAgentWalletBalance / checkOrchestratorGas /
    // checkReserveBalance blocks, with TARGET_CHAIN_ID replaced by chainId
  }
```

The alert keys already carry `:${chainId}`, so per-chain alerts stay distinct with no other change.

In `app/api/preflight/route.ts`, take the chain from the query string and validate it, so the client asks about the chain it is actually on:

```ts
import { isSupportedChain, DEFAULT_CHAIN_ID } from '@/lib/chainPolicy';
import { getTokens } from '@/lib/tokens';

  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  const chainIdParam = Number(url.searchParams.get('chainId'));
  const chainId = isSupportedChain(chainIdParam) ? chainIdParam : DEFAULT_CHAIN_ID;

  // The valid token set is per-chain now — Base has no cUSD.
  const tokens = getTokens(chainId);
  if (!token || !(token in tokens)) {
    return NextResponse.json(
      { error: `token must be one of ${Object.keys(tokens).join(', ')}` },
      { status: 400 },
    );
  }
```

and change the cache key from `tokenSymbol` to `` `${chainId}:${tokenSymbol}` `` so one chain's readiness is never served for another.

- [ ] **Step 5: Run the tests**

Run: `pnpm test:lib && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/reconcile/route.ts app/api/cron/reconcile/route.test.ts app/api/preflight/route.ts lib/agent/walletHealth.ts lib/agent/walletHealth.test.ts
git commit -m "feat(ops): monitor every supported chain, not one pinned chain

reconcile now loops the wallet, gas and reserve checks over the allowlist;
the alert keys already carried :chainId so they stay distinct.

preflight takes the chain from the query and caches per chain — serving one
chain's readiness for another would gate the wrong wallet. minCelo becomes
minNative, since an ETH threshold is not a CELO threshold.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Fix the volume metric and the price copy

`volumeUsd` multiplies a thread count by a hardcoded `0.05`. Once two prices exist in history it is wrong for every thread.

**Files:**
- Modify: `app/api/public/analytics/route.ts:36-46`
- Modify: `app/layout.tsx:25`, `components/ModePicker.tsx:117`
- Test: `app/api/public/analytics/route.test.ts`

**Interfaces:**
- Consumes: Task 4's `getTokens`
- Produces: no new exports

- [ ] **Step 1: Write the failing test**

```ts
// Two prices now coexist in history. Multiplying a thread count by a constant
// is wrong for the old threads and the new ones alike.
it('sums the actual amount each thread paid, across two prices', async () => {
  mockThreadRows([
    { amount_paid_raw: '50000', token_symbol: 'USDC' },   // $0.05
    { amount_paid_raw: '100000', token_symbol: 'USDC' },  // $0.10
    { amount_paid_raw: '100000000000000000', token_symbol: 'cUSD' }, // $0.10, 18 dec
  ]);

  const res = await GET(new Request('http://localhost/api/public/analytics?chainId=42220'));
  const body = await res.json();

  expect(body.volumeUsd).toBe('0.25');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run app/api/public/analytics`
Expected: FAIL — volume is `count * 0.05`.

- [ ] **Step 3: Sum the stored amounts**

In `app/api/public/analytics/route.ts`, add `amount_paid_raw` and `token_symbol` to the `costRows` select, then replace line 46:

```ts
    // Sum what each thread actually paid. A constant per thread was correct
    // only while the price was fixed; setPrice means old and new threads carry
    // different amounts, and amount_paid_raw is the verified on-chain value.
    const tokens = getTokens(chainId);
    let volumeUsd = 0;
    for (const r of costRows ?? []) {
      const t = tokens[r.token_symbol as TokenSymbol];
      if (!t || !r.amount_paid_raw) continue;
      volumeUsd += Number(formatUnits(BigInt(r.amount_paid_raw), t.decimals));
    }
```

- [ ] **Step 4: Update the copy**

- `app/layout.tsx:25` — `'Drop $0.10 in. An on-chain agent pays AI services per call (x402) and hands you a ready-to-post X thread.'`
- `components/ModePicker.tsx:117` — `flat <span className="font-mono text-money">$0.10</span>/thread — mode only changes the agent&apos;s recipe`

Then sweep for any remaining hardcoded price in user-facing copy:

```bash
grep -rn '\$0\.05' --include="*.ts" --include="*.tsx" app components lib
```

- [ ] **Step 5: Run the tests**

Run: `pnpm test:lib && pnpm build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/public/analytics/route.ts app/api/public/analytics/route.test.ts app/layout.tsx components/ModePicker.tsx
git commit -m "fix(analytics): sum real per-thread amounts instead of a constant price

volumeUsd was threads * 0.05. With setPrice, two prices coexist in history
and that constant is wrong for the old threads and the new ones alike —
amount_paid_raw already stores the verified on-chain amount.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: Hardhat networks, deploy script, and the mainnet rollout

Everything that touches a real chain. Nothing here runs until Tasks 1-13 are green.

**Files:**
- Modify: `hardhat.config.ts`
- Create: `scripts/deploy-chain.ts` (replaces the Celo-only `deploy-mainnet.ts` behaviour)
- Create: `deployments/base.json` (written by the script)

**Interfaces:**
- Consumes: Task 1's contract
- Produces: `NEXT_PUBLIC_PAYMENT_CONTRACT_BASE`, `NEXT_PUBLIC_AGENT_WALLET_BASE` env values

- [ ] **Step 1: Add the Base networks**

In `hardhat.config.ts`, add to `networks`:

```ts
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
```

Base verifies on Basescan (Etherscan), Celo on Blockscout, so enable both and let Hardhat pick per chain:

```ts
  verify: {
    blockscout: { enabled: true },
    etherscan: { enabled: true, apiKey: process.env.BASESCAN_API_KEY },
    sourcify: { enabled: false },
  },
```

- [ ] **Step 2: Write the parameterised deploy script**

Create `scripts/deploy-chain.ts`, modelled on `scripts/deploy-mainnet.ts` but taking the expected chain and start id as arguments rather than hardcoding 42220 and `deployments/celo.json`. Keep the assert-expected-chain guard — only its constant was wrong:

```ts
const EXPECTED = {
  base: { chainId: 8453, startThreadId: 1000000n, file: 'base.json' },
  baseSepolia: { chainId: 84532, startThreadId: 1000000n, file: 'baseSepolia.json' },
  celo: { chainId: 42220, startThreadId: 200000n, file: 'celo.json' },
} as const;

const target = EXPECTED[process.env.DEPLOY_TARGET as keyof typeof EXPECTED];
if (!target) throw new Error(`set DEPLOY_TARGET to one of ${Object.keys(EXPECTED).join(', ')}`);

const chainId = await publicClient.getChainId();
if (chainId !== target.chainId) {
  throw new Error(`Wrong network: expected ${target.chainId}, got ${chainId}`);
}
```

Base starts at `1000000n` so a bare thread id identifies its own chain in logs; a Celo redeploy starts at `200000n`, above the existing contract's counter.

- [ ] **Step 3: Verify the USDC address before whitelisting anything**

This is the step the spec flags as unverified. Do it against the chain, not from memory:

```bash
npx hardhat console --network base
# > const usdc = await viem.getContractAt('IERC20Metadata', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')
# > await usdc.read.symbol()    // must be 'USDC'
# > await usdc.read.decimals()  // must be 6
```

If either differs, stop and correct `lib/tokens.ts` before continuing.

- [ ] **Step 4: Base Sepolia dry run**

```bash
DEPLOY_TARGET=baseSepolia npx hardhat run scripts/deploy-chain.ts --network baseSepolia
```

Then set `NEXT_PUBLIC_SUPPORTED_CHAIN_IDS=84532`, `NEXT_PUBLIC_DEFAULT_CHAIN_ID=84532` on a preview deploy and run **one real thread** with a paymaster-capable wallet. Confirm in order: the wallet reports sponsorship, the bundle settles, `resolveBundleTxHash` yields a hash whose receipt contains `ThreadRequested`, and `/api/generate/stream` accepts it. A failure at any point stops the rollout.

- [ ] **Step 5: Base mainnet**

```bash
DEPLOY_TARGET=base npx hardhat run scripts/deploy-chain.ts --network base
```

Then, in order: `setAllowedToken(USDC, true)`; `setDailySpendCap(USDC, 10e6)` on `AgentWallet`; seed the reserve via `scripts/seed-reserve.ts`; set `NEXT_PUBLIC_PAYMENT_CONTRACT_BASE`, `NEXT_PUBLIC_AGENT_WALLET_BASE`, `CDP_PAYMASTER_URL`, `BASESCAN_API_KEY` on Vercel.

**Set Vercel env via the REST API, not `vercel env add` over stdin** — the CLI has stored `""` twice on this project. Verify with `vercel env pull` afterwards; a `type=sensitive` var legitimately pulls as `""`, so probe those by behaviour instead.

Then **prove the refund path with real money**: pay for a thread, force a failure, run `pnpm refund:list` and `pnpm refund:process <id>`, and confirm both the on-chain transfer and the two database rows. This is the gate for opening Base to users.

- [ ] **Step 6: Flip the default, then redeploy Celo**

Set `NEXT_PUBLIC_SUPPORTED_CHAIN_IDS=8453,42220` and `NEXT_PUBLIC_DEFAULT_CHAIN_ID=8453`.

Celo goes last because it is the only step that disturbs something already live: deploy at the new price, `withdrawReserve` from the old contract, seed the new one, repoint `NEXT_PUBLIC_PAYMENT_CONTRACT_MAINNET`, and leave the old contract **paused but not abandoned** so outstanding refunds against it can still be honoured.

- [ ] **Step 7: Commit**

```bash
git add hardhat.config.ts scripts/deploy-chain.ts deployments/
git commit -m "feat(deploy): parameterise the deploy target and add the Base networks

deploy-mainnet.ts asserted chainId 42220 and wrote deployments/celo.json.
The guard was right and stays; only its hardcoded constant moves into a
per-target table.

Base starts at threadId 1000000 so a bare id identifies its own chain in a
log — the database was already safe via the (chain_id, onchain_thread_id)
unique index.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage.** §1 chain registry/policy → Tasks 3, 7. §2 submit strategy → Tasks 8, 9, 10. §3 paymaster proxy → Task 11. §4 operational surface → Tasks 12, 14. §5 contracts/deploy/verify → Tasks 1, 14. §6 attribution → Task 6. §7 pricing, refund source, volume metric, copy, Celo migration → Tasks 1, 2, 4, 13, 14. The server-side allowlist called out in §1 → Task 5. Every spec section maps to at least one task.

**Type consistency.** `isSupportedChain` is defined once (Task 3, `lib/chainPolicy.ts`) and removed from `lib/chains.ts` in the same task, so Tasks 5, 7 and 12 import it from one place. `getOnChainPaidAmount` changes signature in Task 2 and has exactly one caller, updated in the same task. `getTokens` becomes `Partial<...>` in Task 4 with all four indexing call sites guarded there. `getAttributionSuffix` gains its `chainId` parameter in Task 6 with both call sites updated there. `payForThread` gains `maxAmount` in Task 1, the ABI follows in Task 4, and the two call sites (bundle and EOA) in Tasks 9 and 10.

**Known gap, deliberate.** The exact CDP paymaster request/response shape is assumed from the EIP-5792 `paymasterService` capability, not confirmed against CDP's documentation. Task 11's allowlist logic and its tests are independent of that shape, but if CDP's method names or parameter positions differ, the parameter indices in `POST` (`params[0]`, `params[2]`) need adjusting when Task 14 step 4 is run. Confirm against CDP docs before the Base Sepolia dry run rather than during it.

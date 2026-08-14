# Base as a first-class chain — design

**Date:** 2026-08-14
**Status:** Design approved, pending spec review
**Scope:** Make **Base mainnet (8453)** a fully supported payment chain and the
default one, with gas sponsored by a paymaster, **without removing the working
Celo/MiniPay path**. Raise the thread price from **$0.05 to $0.25** and make it
owner-settable (§7). Sub-project 1 of 3 (see Non-goals).

## Background

CoinOp today runs on exactly one chain at a time. `lib/targetChain.ts` reads
`NEXT_PUBLIC_TARGET_CHAIN_ID` and pins the whole app to Celo mainnet (42220) or
Celo Sepolia (11142220). MiniPay is the primary surface, and MiniPay is
Celo-only: it exposes no `wallet_switchEthereumChain`, and its users hold zero
CELO because Celo lets them pay gas in cUSD.

Moving to Base loses that gas abstraction. On Base, `payForThread()` is an
ordinary transaction requiring ETH. For a $0.05 product, requiring a user to
acquire ETH first is a larger barrier than the price of the product, so Base
support is only worth building together with gas sponsorship.

### What was verified before writing this

Read directly from the repo in this session:

- **The backend is already chainId-parametric.** `/api/generate/stream` takes
  `chainId` from the request body and threads it through
  (`route.ts:13,100,123,193,240,267`). Every orchestrator entry point takes
  `chainId` and resolves through `getChain(chainId)` / `getContracts(chainId)` /
  `getTokens(chainId)` (`lib/agent/orchestrator.ts:18-24,52-55,80-82`).
  `lib/tokens.ts`, `lib/contracts.ts` and `lib/chains.ts` are already maps keyed
  by chain id.
- **The database was built for multiple chains.** `threads.chain_id` exists since
  migration `0001_threads.sql:4`, with `create unique index threads_onchain_idx
  on threads (chain_id, onchain_thread_id)` (`0001:29`) — two chains can issue
  overlapping on-chain thread ids without colliding. `refund_requests.chain_id`
  (`0004:5`) and `funnel_events.chain_id` (`0006:11`) exist too. **No migration
  is required by this work.**
- **Single-chain pinning lives only at the edges.** Only 7 non-test files read
  `TARGET_CHAIN_ID` / `getTargetChain` / `targetChainName` / `IS_TESTNET_TARGET`:
  `app/HomeClient.tsx`, `app/api/preflight/route.ts`,
  `app/api/cron/reconcile/route.ts`, `components/WalletMenu.tsx`,
  `lib/usePayForThread.ts`, `lib/wagmi.ts`, and `lib/targetChain.ts` itself.
- **`body.chainId` is not allowlisted.** `/api/generate/stream:72` is only
  `if (!b.chainId) return 'chainId required'` — a truthiness check. Unknown
  chains are currently rejected incidentally, by `getContracts()` throwing,
  which surfaces as a 500 rather than a 400.
- **`verifyPayment` already tolerates smart-wallet transactions.** It filters
  `receipt.logs` by our contract's address rather than by `receipt.to`, with the
  comment "don't rely on receipt.to — tolerate router/multicall paths"
  (`lib/agent/orchestrator.ts:96-98`). No change needed for bundled calls.
- **EIP-5792 is available in the installed dependencies, not experimental.**
  wagmi 2.19 exports `useSendCalls`, `useCapabilities` and
  `useWaitForCallsStatus` from its main entry point. viem 2.48
  (`_types/types/capabilities.d.ts:32-45`) types `getCapabilities` as returning
  `paymasterService: { supported: boolean }` and `sendCalls` as accepting
  `paymasterService: { url: string; context?: …; optional?: boolean }`.
- **Base is already half-configured for x402.** `lib/x402/config.ts:38-43`
  carries Base mainnet with USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`,
  EIP-712 domain `{ name: 'USD Coin', version: '2' }`, and no `v1Network` shim.
  `lib/chains.ts:27-28` already maps 8453 → basescan.org and 84532 →
  sepolia.basescan.org.
- **The deploy script is Celo-hardcoded.** `scripts/deploy-mainnet.ts:50` throws
  unless `chainId === 42220`, and writes `deployments/celo.json` (`:85,111`).
  `startThreadId` is `100000n` on both existing deploys
  (`deploy.ts:36`, `deploy-mainnet.ts:69`).
- **Contract verification differs per chain.** `hardhat.config.ts:44-48` sets
  `verify.blockscout.enabled = true` and `etherscan.enabled = false` globally,
  with a `chainDescriptors` entry only for 42220.
- **The attribution tag is applied unconditionally.** `lib/attributionTag.ts`
  builds an ERC-8021 suffix from `@celo/attribution-tags` with no chain
  parameter, and `lib/usePayForThread.ts` passes it as `dataSuffix` on every
  transaction.

### What is NOT verified, and must be before spending money

- **The Base USDC address above is taken from our own `lib/x402/config.ts`, not
  from an authoritative source this session.** It must be confirmed on-chain
  (`symbol()`, `decimals()`, `version()`) before it is whitelisted on a mainnet
  contract. The Base MCP server was added but still reports
  `Needs authentication`, so it could not be used for this.
- **CDP Paymaster specifics** — endpoint shape, whether contract allowlisting is
  configured in the CDP dashboard or per-request, and quota behaviour — are
  assumed, not confirmed. Step 1 of the rollout does not depend on them; step 2
  does.
- **Whether Base Account (in Base App or the Coinbase Wallet extension) reports
  `paymasterService.supported === true`** on chain 8453. The design degrades
  safely if it does not (see §2), but the happy path is unproven.
- **That the Celo reserve is empty** comes from project notes dated 2026-07-28,
  not from an on-chain read in this session. Re-read before acting on §4.

## Goal and non-goals

**Goal:** a user with only USDC and no ETH on Base can pay $0.05 and get a
thread, with the same refundability guarantees the Celo path has; Celo/MiniPay
keeps working unchanged.

**Non-goals** — each is a separate spec:

1. **Base App mini app distribution** (manifest, MiniKit, the Base App
   equivalent of `detectMiniPay()`). This spec makes Base *work*; it does not
   make Base *reachable* by new users.
2. **Moving Model 2 x402 settlement to Base/CDP.** Independent by construction —
   `lib/x402/config.ts` decouples the settle chain from the payment chain.
3. **Retiring Celo.** Explicitly not done. Removing Celo is pure work with no new
   capability, and it would forfeit ERC-8004 agentId 9751, the ERC-8021
   attribution code, and Track 1 revenue history. Retiring later stays cheap.

## Accepted trade-off: smart accounts are separate identities

With a paymaster, `msg.sender` for `payForThread` is the smart account address,
not the user's EOA. `ThreadRequested.user` and every wallet-keyed history lookup
therefore record the smart account. One human using both an EOA and a smart
account has **two separate thread histories**.

This is accepted, deliberately, and will not be reconciled. Merging identities
would mean either trusting a client-supplied link between two addresses or
maintaining an address-mapping table — both are more risk than the problem
warrants, and neither is invisible to the user the way a clean split is.

## Design

### 1. Chain registry vs chain policy

`lib/targetChain.ts` becomes a false name the moment two chains are live, so
split it by responsibility and delete it:

- **`lib/chains.ts` — the registry.** Which chains exist and how to reach them:
  `getChain` (add `base`, `baseSepolia`), `explorerBase` (already correct),
  `isSupportedChain`.
- **`lib/chainPolicy.ts` — the policy.** `DEFAULT_CHAIN_ID` (from
  `NEXT_PUBLIC_DEFAULT_CHAIN_ID`, falling back to 8453),
  `SUPPORTED_CHAIN_IDS` (from `NEXT_PUBLIC_SUPPORTED_CHAIN_IDS`, falling back to
  `[8453, 42220]`), `chainLabel(chainId)`, `isTestnet(chainId)`.

The 7 consumers switch from "is the wallet on *the* chain" to "is the wallet on
*a supported* chain", and from `targetChainName()` to `chainLabel(chainId)`.

`lib/wagmi.ts` takes `chains: [base, celo]` (default first) with a transport per
chain. RainbowKit's wallet list keeps `injectedWallet` first — MiniPay auto-connect
depends on it (`lib/wagmi.ts:32-38`) and must not regress.

`lib/tokens.ts` gains `BASE_MAINNET_TOKENS`. **USDC only for now** — see the
YAGNI note below. Because `TokenSymbol` stays a union of all three symbols while
`getTokens(8453)` returns a map without `cUSD`, the return type becomes
`Partial<Record<TokenSymbol, TokenConfig>>` and callers must handle a missing
symbol rather than assume presence. This is the one type change that ripples;
it is preferable to a per-chain symbol union, which would infect every call site.

`lib/contracts.ts` gains a `[base.id]` entry once deployed.

**YAGNI: Base ships with USDC only.** USDT on Base is deliberately omitted from
the first cut, because its address could not be verified this session and an
unverified token address reaching a mainnet whitelist is exactly the class of
mistake that costs real money. Adding it later is one entry in one map plus one
`setAllowedToken` call.

### 2. Payment path: a submit strategy, chosen by wallet capability

`lib/usePayForThread.ts` keeps its current **submit sequence** unchanged —
allowance read, approve, approve-receipt status check (`:185-200`), then
`payForThread`, plus the wallet-chain resync loop (`:152-170`). That sequence
encodes hard-won knowledge and must not be rewritten. Its *chain guard* does
change, from `chainId !== TARGET_CHAIN_ID` (`:103`) to
`!isSupportedChain(chainId)`, as for the other six consumers in §1. The submit
sequence then becomes one of two strategies:

```
useCapabilities({ chainId })
  paymasterService.supported === true  →  submitViaSendCalls
  otherwise                            →  the existing EOA path, unchanged
```

`submitViaSendCalls` sends **one** bundle containing `[approve, payForThread]`
with `capabilities.paymasterService = { url: '/api/paymaster', optional: true }`.

Two properties matter more than gas:

- **Batching removes the approve/pay gap entirely.** That gap is the root of the
  USDT approve-receipt bug and the still-unverified first-payment
  allowance-0 bug. In a bundle, approve and pay are atomic — there is no
  intermediate state to fail into. This is a correctness improvement, not a
  convenience.
- **`optional: true` is the degradation lever.** If the paymaster declines or is
  out of quota, the wallet submits the bundle unsponsored (user pays gas) instead
  of failing outright. The UI must therefore never *promise* free gas before the
  wallet responds; it may only report afterwards that gas was covered.

**The bundle-id gotcha.** `sendCalls` returns a **call bundle id, not a
transaction hash**, while `/api/generate/stream` requires a real `payTxHash` to
run `verifyPayment`. The frontend must await `useWaitForCallsStatus` and take
`receipts[].transactionHash` before POSTing. Getting this wrong breaks
verification for every sponsored payment, so it is called out here rather than
left to implementation.

### 3. `/api/paymaster` is a guarded proxy, never a passthrough

The CDP paymaster URL is a secret and must never reach the client. This route
forwards only `pm_getPaymasterStubData` / `pm_getPaymasterData`, and enforces:

- `chainId === 8453` only;
- sponsorship only for calls to **our** `ShipPostPayment` address, and for
  `approve` calls on **whitelisted tokens whose spender is that same address**;
  every other target is rejected;
- an Upstash rate limit (Upstash is already a project dependency), keyed by IP.

Without the allowlist this endpoint is a public wallet for anyone who finds it.
The test asserting that a non-allowlisted target is rejected is the single most
important test in this spec.

### 4. Operational surface, which genuinely doubles

|                        | Celo                          | Base            |
| ---------------------- | ----------------------------- | --------------- |
| `ShipPostPayment`      | `0x0dea…` live                | to deploy       |
| `AgentWallet`          | `0x006c…` live                | to deploy       |
| Reserve (refunds)      | **believed 0 — `refund()` reverts** | to seed   |
| Orchestrator gas       | CELO                          | ETH             |
| Daily spend cap        | $10/token/day                 | $10 to match    |

**Both chains get a funded reserve.** A chain that accepts payment without being
able to refund it should not exist, so seeding the reserve is a precondition for
opening a chain to real users — not follow-up work. Adding Base while Celo's
reserve sits at zero would leave *two* chains taking money they cannot return.

`app/api/cron/reconcile/route.ts:57,82,102` and `app/api/preflight/route.ts:34`
loop over `SUPPORTED_CHAIN_IDS` instead of one pinned id. The existing alert keys
already carry a `:${chainId}` suffix (`reconcile/route.ts:60,83,105`), so
per-chain alerts stay distinct with no key redesign.
`checkOrchestratorGas({ minCelo })` becomes `{ minNative }` with a per-chain
threshold, since an ETH balance and a CELO balance are not comparable numbers.

### 5. Contracts: one deliberate Solidity change (see §7), then redeploy

`AgentWallet.sol` runs on Base unchanged. `ShipPostPayment.sol` would also have
run unchanged — `IERC20Metadata(token).decimals()` is already dynamic, SafeERC20
is already used, `Pausable` and the token whitelist carry over — but the pricing
change in §7 requires modifying it.

**This weakens, but does not overturn, the §2 argument.** Choosing a paymaster
over an EIP-3009 rewrite was justified partly by "no Solidity change, so no
invariant needs re-auditing". That is no longer free. It remains the right call
for a narrower reason: the §7 change is additive and local (a price variable, an
owner setter, one extra parameter), whereas an EIP-3009 rewrite would replace
the entire payment entry point and the `ThreadRequested` evidence that
`verifyPayment` depends on. The blast radius differs by an order of magnitude.

Outside Solidity:

- **`startThreadId` is offset per chain**: Base starts at `1000000n` (Celo used
  `100000n`). The database is already safe via the `(chain_id,
  onchain_thread_id)` unique index; the offset is for humans, so a bare thread id
  in a log or a support conversation identifies its own chain.
- **Parameterise the deploy script.** Replace the hardcoded
  `chainId !== 42220` guard and the fixed `deployments/celo.json` path
  (`scripts/deploy-mainnet.ts:50,85,111`) with a network argument writing
  `deployments/<network>.json`. Keep the assert-expected-chain behaviour — that
  guard is good, only its hardcoded constant is wrong.
- **Verification is per-chain.** Add `base` (8453) and `baseSepolia` (84532) to
  `hardhat.config.ts` networks, enable `verify.etherscan` for Base while Celo
  keeps Blockscout, and add `BASESCAN_API_KEY`.

### 6. Attribution tag becomes chain-conditional

`getAttributionSuffix()` gains a `chainId` parameter and returns `null` for any
non-Celo chain. On Base the ERC-8021 suffix is calldata no program reads; the
EVM ignores it, so it is harmless but dishonest — it makes transactions look
tagged for a program they cannot enter.

### 7. Pricing: $0.05 → $0.25, and make it settable

The price is currently hardcoded in Solidity with no setter
(`ShipPostPayment.sol:88-94`: `return 5 * (10 ** (d - 2))`), so changing it at
all means redeploying. Base is a fresh deploy regardless, which makes this the
cheapest moment this change will ever have.

**Why raise it at all.** At $0.05 the 50/40/10 split yields $0.025 to the agent,
$0.02 to treasury, $0.005 to reserve, while the agent spends at most 4 × $0.001 =
$0.004 — the agent share is roughly 6× oversized. More importantly, **Base
introduces a cost Celo never had**: sponsored gas. On Celo the user paid gas in
cUSD; on Base we pay it. A sponsored bundle plausibly costs a meaningful
fraction of the $0.02 treasury share, so $0.05 may not be profitable on Base at
all. $0.25 covers sponsorship with real headroom while staying an impulse
purchase.

**Note honestly:** organic usage is currently near zero, so price is not the
constraint on revenue — distribution is. This change makes each sale sustainable;
it does not by itself increase sales.

**The contract change** is additive:

- `uint256 public priceUsdCents` (initialised to `25`), replacing the literal
  `5` in `requiredAmount`, which becomes `priceUsdCents * (10 ** (d - 2))`.
- `setPrice(uint256 newPriceUsdCents) external onlyOwner`, emitting
  `PriceUpdated(uint256 previous, uint256 current)`.
- **`payForThread(address token, uint8 mode, uint256 maxAmount)`** — reverts with
  `PRICE_EXCEEDS_MAX` if `requiredAmount(token) > maxAmount`. This is not
  optional. A settable price without a ceiling lets the owner change the price
  in the interval between a user reading it and their transaction landing,
  charging more than the user consented to. The ceiling makes the user's consent
  explicit and on-chain.

**Consequence for refunds — a real bug this introduces.** `getOnChainPaidAmount`
(`lib/agent/orchestrator.ts:48-63`) derives the refundable amount from a live
`requiredAmount(token)` read, and `scripts/process-refund-request.ts:127` refunds
that. Correct while the price is immutable; **wrong the moment it is not** — a
thread bought at $0.05 would be refunded at the current price, draining reserve
beyond what was ever paid.

The CLAUDE.md invariant ("refund amount is read on-chain, never from
client-supplied fields") is preserved, but its **source must change**: read the
`amount` field of the `ThreadRequested` event for that specific `threadId`. That
value is what was actually transferred, it is already decoded by `verifyPayment`
(`orchestrator.ts:96-115`), and it is immune to later price changes.

**Consequence for the client.** With a mutable price the client must stop
computing the price and start reading it. `computeTokenAmount()`
(`lib/tokens.ts:65-71`) becomes a display fallback only; the approve amount, the
`maxAmount` argument, and the displayed price all derive from a
`readContract requiredAmount(token)` call. If the price changes between that read
and the transaction, the `maxAmount` ceiling reverts it — which is the intended
behaviour, not an error to paper over.

**Also fix the volume metric.** `app/api/public/analytics/route.ts:46` computes
`volumeUsd = threads * 0.05` from a hardcoded constant that does not even import
`THREAD_PRICE_USD`. Once two prices exist in history this is permanently wrong,
for old and new threads alike. It must sum the per-thread stored amount instead.

**Copy carrying the old price** must move in the same commit: `app/layout.tsx:25`
and `components/ModePicker.tsx:117` both state "$0.05" literally.

**Celo pays a migration cost.** Unlike Base, Celo has a live contract holding the
reserve in its own balance. Raising the price there means: deploy the new
contract, `withdrawReserve` from the old one, seed the new one, repoint
`NEXT_PUBLIC_PAYMENT_CONTRACT_MAINNET`, and leave the old contract paused but
callable so any outstanding refund against it can still be honoured. Old threads
keep resolving against the old address, which the per-thread event lookup above
already handles.

## Testing

**Vitest — runs immediately, costs nothing:**

- an unsupported `body.chainId` returns **400**, not 500, and is rejected before
  any Supabase query or paid work;
- `getTokens(8453)` / `getContracts(8453)` resolve; `getTokens(8453).cUSD` is
  `undefined` and callers handle it;
- `getAttributionSuffix(8453)` is `null`; `getAttributionSuffix(42220)` is not;
- **`/api/paymaster` rejects a call targeting any address other than
  `ShipPostPayment`, and rejects an `approve` whose spender is not
  `ShipPostPayment`**;
- the bundle builder produces the expected `calls` array and `capabilities`
  object (pure function, no wallet needed).

- **the refund amount comes from the thread's `ThreadRequested.amount`, not from
  a live `requiredAmount()` read** — assert explicitly that a thread priced at
  the old rate still refunds at the old rate after `setPrice`;
- `volumeUsd` sums stored per-thread amounts, and is correct for a data set
  containing both a $0.05 and a $0.25 thread.

**Hardhat:** generalise the `CELO_FORK` flag to select a fork network, and add a
Base fork for the decimals tests so they run against real USDC. Plus, for §7:

- `requiredAmount` tracks `setPrice` across all supported decimals (6 and 18);
- `setPrice` is `onlyOwner` and emits `PriceUpdated`;
- **`payForThread` reverts when `requiredAmount > maxAmount`**, including the
  race it exists to prevent: read price, owner raises it, transaction lands,
  transaction reverts rather than overcharging;
- the reserve/agent/treasury split still sums exactly to `amount` at the new
  price, with dust landing in reserve.

**Manual, unavoidable:** EIP-5792 sponsorship cannot be meaningfully mocked. The
`bundle id → tx hash → verifyPayment` chain must be exercised on Base Sepolia,
then on mainnet, with a real wallet.

**CI:** run `npx tsc --noEmit`. Neither `pnpm test:lib` nor `pnpm build`
typechecks `*.test.ts`, so type errors in tests only surface in CI.

## Rollout

Each step is one commit, straight to `main`.

1. **Contract change + tests (§7).** `priceUsdCents`, `setPrice`, the `maxAmount`
   parameter, and the refund-source fix. Nothing deployed yet; Hardhat tests
   carry it. Doing this first means every later deploy ships the final contract.
2. **Config, allowlist, tests.** `chainPolicy`, registry additions, the 400
   allowlist, chain-conditional attribution, cron/preflight loops, the paymaster
   route with its allowlist tests, the client's switch from computing the price
   to reading it, the volume-metric fix, and the price copy. Nothing is deployed;
   no money is at risk. This is the bulk of the code.
3. **Base Sepolia.** Deploy, then run one real thread through the paymaster and
   confirm `bundle id → tx hash → verifyPayment` end to end.
4. **Base mainnet.** Verify the USDC address on-chain, deploy, whitelist, seed the
   reserve, set the daily cap, and **prove the refund path with real money** the
   way the Celo path was proven on 2026-07-27.
5. **Flip the default** to `DEFAULT_CHAIN_ID=8453`.
6. **Celo redeploy at the new price**, migrating the reserve per §7 and closing
   the empty-reserve gap in §4 in the same move. Celo goes last because it is the
   only step that disturbs something currently live.

Steps 1–2 carry most of the work and none of the financial risk, so that is where
effort should concentrate. No step after 2 should begin while their tests are
red.

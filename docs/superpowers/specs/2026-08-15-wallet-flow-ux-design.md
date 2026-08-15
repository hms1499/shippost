# Wallet flow UX — connect, chain choice, and the states around them

**Date:** 2026-08-15
**Status:** design approved, not yet planned
**Scope:** the wallet layer only — connect, chain selection, and the wallet-dependent
states that sit around them. The generation and pay pipelines are untouched except
where a wallet decision leaks into them.

## Why now

The Base migration (2026-08-14, spec `2026-08-14-base-first-class-chain-design.md`)
made CoinOp a two-chain app in the data model but not in the interface. `isSupportedChain`
accepts Base and Celo; `switchChain` is called from exactly one place and always targets
`DEFAULT_CHAIN_ID`. The result is that **which chain a user pays on is decided by wherever
their wallet happened to be**, and there is no way to choose otherwise.

Everything downstream inherits that: which token they can pay in, whether their gas is
sponsored, which contract takes the money. None of it is visible, and none of it is theirs
to decide.

## The state today

Three branches — MiniPay, web wallet, and disconnected — over nine states.

**Connect**

| State | MiniPay | Web (RainbowKit) |
|---|---|---|
| Pre-mount | `Loading…` chip | `Loading…` chip |
| Connecting | `Connecting MiniPay…`, auto, one shot | `LandingHero` + connect CTA |
| Failed | after 5s: "Could not connect… try closing and reopening" — **no retry** | RainbowKit handles it |
| Connected | address chip + `via MiniPay` | address chip + `via <wallet>` |

**Chain** — full-screen gate at `app/HomeClient.tsx:960-995`. MiniPay gets correct
Developer-Settings guidance (MiniPay exposes no `wallet_switchEthereumChain`). Web gets a
single red line pointing at a control somewhere else.

**Everything else** — `WalletStatus` (balances), the `WalletMenu` sheet (copy / history /
switch / disconnect).

### Six problems, ranked

1. **No chain choice exists.** `WalletMenu.tsx:102` only ever switches to `DEFAULT_CHAIN_ID`.
   There is no path to Celo by intent.
2. **The chain is nearly invisible when things work.** It appears once, in the sheet header
   (`Account · Base`). `WalletStatus` shows balances without saying whose. At the pay moment
   the user cannot tell which chain is about to be charged.
3. **Gas sponsorship is never mentioned.** On Base with an EIP-5792 wallet the user pays no
   gas — the best moment the product has — and the UI is silent. MiniPay users pay gas. Same
   `$0.10` label, different real cost.
4. **`switchChain` is fire-and-forget.** `WalletMenu.tsx:97` destructures only `switchChain`,
   dropping `isPending` and `error`. A user who declines the wallet prompt sees nothing move.
5. **Web wrong-network is a dead end** — copy that points at another control instead of
   offering the action.
6. **`No stable balances on this chain.`** is a full stop with no way out.

## Decisions

| Question | Decision |
|---|---|
| Chain model | Users choose. Explicit picker for web wallets; MiniPay stays pinned to Celo. |
| What the picker shows | Real balances on **both** chains, plus who pays gas. |
| Where it lives | Chain name on the header chip (tap → sheet), restated as one line at the pay moment. |
| Where "selected chain" lives | **Approach A — the wallet is the truth.** |

### Why Approach A

`selectedChain === useChainId()`. The picker is a `switchChain` call and nothing else.

The alternative considered and rejected was app-held `selectedChainId` with the switch
deferred to pay time. It is tempting because it is already half-built: `usePayForThread.ts:194-213`
reconciles a mismatched wallet chain, polling 15×200ms with real error copy. It would also
save a wallet prompt.

It was rejected because it creates a second source of truth for "the current chain". Roughly
twenty `useChainId()` call sites in `HomeClient` would silently disagree with the user's
selection — precisely the failure `CLAUDE.md` names as a standing rule ("that is how a chain
gets accepted in one layer and rejected in another"). It also moves the wallet prompt to the
most sensitive moment in the funnel.

The wallet prompt on switch is not the thing that makes this flow feel cheap. The missing
pending/rejected handling is.

## Design

### 1. State model, and the stale-token hazard

No new state. The picker calls `switchChain`; `useBalances`, `getTokens`, `getContracts` and
every `useChainId()` consumer keep working unchanged.

**The hazard the picker introduces.** The payment token is chosen inside the input form and
**captured into the submitted payload** (`HomeClient.tsx:496-497`), before the preview. Today
that capture cannot go stale, because there is no way to change chain mid-flow. With a picker:

```
Celo → pick cUSD → submit → preview
     → switch to Base
     → Unlock
     → pay(cUSD-token-object, mode) executes on Base
```

`usePayForThread` resolves `getContracts(chainId)` to the **Base** contract while
`token.address` is still **Celo cUSD**. On Base that address has no code — the approve goes
nowhere, or reverts. If some unrelated contract occupies that address on Base, behaviour is
undefined.

**Resolution — re-derive, don't discard.** On `chainId` change:

- Symbol exists on the new chain (USDC → USDC): keep it, say nothing. Announcing a
  non-event is noise.
- Symbol absent (cUSD → Base): fall back to the highest balance on the new chain and **say
  so** — `Now paying with USDC on Base`.
- No funded token: keep the screen, disable Unlock, give the reason (§3d).

**Second gate, non-negotiable.** `usePayForThread` re-asserts that the token belongs to the
chain it is about to spend on, immediately before approve:
`getTokens(chainId)[token.symbol]?.address === token.address`, mismatch fails loudly. The UI
can race; this is where real money leaves. It is the repo's verify-before-spend rule applied
client-side.

### 2. Chip, picker, and the switch lifecycle

**Header chip** gains the chain name:

```
now                      →   after
┌──────────────┐             ┌────────────────────┐
│ ● 0x64…ae78  │             │ ● BASE  0x64…ae78  │
└──────────────┘             └────────────────────┘
   via MiniPay                  via Coinbase Wallet
```

No brand colours. The theme is monochrome terminal plus `--primary`; Coinbase blue and Celo
yellow would break it. Chains are distinguished by uppercase mono type.

**Picker** sits in the sheet, below the address block:

```
┌────────────────────────────────────┐
│ Account · Base              close  │
│ ● 0x64…ae78                  copy  │
│   Connected via Coinbase Wallet    │
│ ────────────────────────────────── │
│ PAY ON                             │
│ ┌────────────────────────────────┐ │
│ │ ●  BASE              no gas    │ │
│ │    USDC 2.40                   │ │
│ ├────────────────────────────────┤ │
│ │ ○  CELO         you pay gas    │ │
│ │    cUSD 0.30 · USDT — · USDC — │ │
│ └────────────────────────────────┘ │
│ My History                         │
│ Disconnect                         │
└────────────────────────────────────┘
```

Balances for the **unconnected** chain are fetched when the sheet opens, not on page load —
both RPCs are public and rate-limit-prone (`mainnet.base.org` bursts, `forno.celo.org` drops
transactions; see `.claude/docs/architecture.md`). While loading, render `USDC ·····`, never
`0.00` — a false zero reads as "you are broke" and is acted on.

**Switch lifecycle** — currently absent in every row below the first:

| State | Source | UI |
|---|---|---|
| pending | `isPending` | target row shows spinner + `switching…`; picker disabled |
| success | `chainId` changes | sheet closes; if the token was re-derived, `Now paying with USDC on Base` on the main screen |
| user declined | `error`, code `4001` | row reverts; small line under the picker: `Switch declined in wallet.` — not a red banner |
| wallet cannot switch | `SwitchChainNotSupportedError` | `This wallet can't switch chains. Change network in the wallet, then reopen.` |
| other | `error` | the wallet's own message, truncated |

**MiniPay gets no picker, but not silence:**

```
│ PAY ON                             │
│ ● CELO · MiniPay runs on Celo only │
```

A hidden control with no explanation reads as a missing feature. Stated, it reads as a
decision.

### 3. The states around it

**a) Pay-moment line** — under the CTA:

```
┌──────────────────────────────────┐
│  Generate full thread · $0.10    │
└──────────────────────────────────┘
   USDC on Base · no gas    change →
```

`change →` opens the sheet.

`unlock()` is the only path to `pay()`, but **three** CTAs reach it: `PreviewLocked`
(`HomeClient.tsx:637`), the `preview-unavailable` screen (`:658`), and the `spend-unavailable`
retry (`:688`). The line belongs to all three — a user who never saw a preview is the one
least likely to know which chain they are on. Build it as one shared component rather than
three copies.

**Honesty rule: "no gas" may only be shown when it is known.** Sponsorship is only knowable
via `getCapabilities`, which today runs *inside* `pay()` — after the user has committed. Probe
it once on connect (a wallet-local call, no RPC). If the probe fails or the wallet is silent,
**say nothing about gas** and render `USDC on Base` alone. Promising "no gas" to a MiniPay
user who will pay gas is the fastest way to lose the trust this line exists to build.

**b) Web wrong-network** becomes an action, not a pointer:

```
┌────────────────────────────────────┐
│  Wrong network                     │
│  CoinOp runs on Base or Celo.      │
│  You're on Ethereum (chainId 1).   │
│                                    │
│  [ Switch to Base ]  [ Celo ]      │
└────────────────────────────────────┘
```

Both chains are offered. Forcing everyone to Base here would contradict the picker.

**c) Connect.** The MiniPay timeout branch (`HomeClient.tsx:946-950`) gains a real **Retry**
button. `autoConnectAttempted` is currently a one-way `useRef`, so retry must be able to
reset it or the button does nothing.

**d) Empty balance** becomes an exit:

```
No USDC on Base.
You have cUSD 0.30 on Celo.   [ Switch to Celo ]
```

This deliberately breaks the lazy-loading rule from §2: when the **current** chain's balance
is zero, fetch the other chain eagerly. That is the one moment a spare RPC call earns its
keep — the user is stuck. The funded path still costs nothing extra.

**e) Wallet errors** reuse `lib/payError.ts`, which already unwraps EIP-1193 codes including
one level of `cause` (`findCode`, lines 27-32) — exactly what is needed to recognise
`4001 = user rejected`. Extract the shared core and add `describeSwitchError`; leave
`describePayError` and its tests untouched.

## Files expected to change

| File | Change |
|---|---|
| `components/WalletMenu.tsx` | chain on chip; picker; switch lifecycle states |
| `components/WalletStatus.tsx` | chain label; empty-balance exit |
| new: pay-moment line component | chain/token/gas line, shared by all three unlock CTAs |
| `components/PreviewLocked.tsx` | render the pay-moment line |
| `app/HomeClient.tsx` | wrong-network block; MiniPay retry; token re-derivation on chain change |
| `lib/useBalances.ts` | read balances for an explicit chainId (cross-chain reads) |
| `lib/usePayForThread.ts` | token-belongs-to-chain assertion before approve |
| `lib/payError.ts` | extract core, add `describeSwitchError` |
| new: capability probe | `getCapabilities` once on connect, for the gas line |

## Testing

Vitest over `lib/` and `app/` is the existing harness (621 passing). The load-bearing units
are pure and testable without a browser:

- token re-derivation: same-symbol keeps, missing-symbol falls back to highest balance,
  no-funded-token yields the disabled state
- `describeSwitchError`: `4001` → declined, `SwitchChainNotSupportedError` → the manual-change
  copy, unknown → the wallet's own string
- the token-belongs-to-chain assertion: matching pair passes, cross-chain pair throws
- gas-line policy: sponsorship unknown ⇒ no gas claim rendered

Runtime verification of connected-state UI needs an injected EIP-1193 provider — the `verify`
skill covers the dev-server + Playwright mock setup for MiniPay and web wallet shapes.

## Out of scope

- **Live price at the pay moment.** The CTA renders the static `THREAD_PRICE_LABEL` while
  `CLAUDE.md` requires the displayed price to come from `readThreadPrice()`. Both chains are
  $0.10 today so nothing is wrong yet, but the price is settable **per contract** and can
  diverge at any time. This belongs to the pay flow, not the wallet flow, and costs an RPC
  read per preview. Tracked, not done here.
- The generation pipeline, refunds, and the x402 layers.

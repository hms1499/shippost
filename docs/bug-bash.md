# Bug bash + perf log

Operational notes accumulated during week-3 polish. Each entry is a snapshot
in time — verify before relying.

## Bundle audit (Task 17 — 2026-05-06)

Next.js First Load JS reported by `next build`. Raw kB (Next does not gzip in this
report). Spec budget is ≤200 kB gzipped, which roughly maps to ~600 kB raw — we are
comfortably under after lazy-loading.

| Route | Before lazy-load | After lazy-load |
|---|---|---|
| `/` | 286 kB | 217 kB |
| `/history` | n/a | 143 kB |
| `/stats` | n/a | 102 kB |

Remaining bulk on `/` is wagmi/viem core — can't be lazy-loaded without breaking
auto-connect for MiniPay. Mid-flow components now hydrate on demand:

- `EducationalInput`, `HotTakeInput` — load when user picks a mode
- `GeneratingStatus` — loads after pay
- `ThreadPreview`, `ShareToX`, `PostShareScreen` — load post-generation

`pnpm analyze` opens the full client/server treemap.

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

## Mobile polish (Task 18 — 2026-05-06)

Code-level audit (no real-device testing yet):

- ✅ Tap targets: bumped Button `default` to `h-11` (44 px) and `lg` to `h-12` (48 px). Meets iOS HIG / Android Material recommendations.
- ✅ Viewport: `app/layout.tsx` allows pinch-zoom (no `maximumScale` lock).
- ✅ Theme: dark mode default already set on `<html>`.
- ✅ Bundle on `/` is 217 kB raw / ~70-80 kB gzipped — well under the 200 kB gzipped budget.

### Items needing real-device verification

- Textarea (`HotTakeInput`) keyboard occlusion on Android.
- Progress theatre layout shift while step rows animate in.
- Scroll restoration on screen transitions.

To do on next round of mainnet testing — log results below as they come in.


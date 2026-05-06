# ShipPost

The pay-per-post AI thread writer for crypto builders. $0.05/thread. No subscription. Powered by MiniPay.

Proof of Ship competition submission — April 2026.

## Status

🛠 **Week 3 of 4 — Both modes live, analytics public**

- ✅ Mode A (Educational) — Groq draft on Celo Sepolia + mainnet
- ✅ Mode B (Hot Take) — Serper + CoinGecko + Groq draft + fact-check
- ✅ Personal `/history` + public `/stats` pages (Supabase, 30s revalidate)
- ✅ ErrorSurface covers 8 spec error states (insufficient / approve-rejected / pay-failed / partial / full-fail / cap-hit / slow / agent-paused)
- ✅ Admin refund flow — `pnpm refund` CLI + `/api/refund` gated by `REFUND_ADMIN_KEY`
- ✅ Pause kill switch script — `pnpm hardhat run scripts/pause.ts`
- ✅ Bundle audited, mid-flow components lazy-loaded
- ⏭️ Week 4: judge analytics, demo video, pitch deck, submission

## Quick start

```bash
pnpm install
pnpm dev
```

See `docs/superpowers/specs/` for full design doc.

# Hot Take reads pasted URLs (review #5)

Date: 2026-06-08
Status: approved

## Problem

Hot Take invites "Paste a tweet or article URL" (`HotTakeInput.tsx:137`), but the
agent never reads the link. `eventUrl` is collected and shown via
`UrlPreviewCard`, then dropped — `HomeClient` sends only `eventDescription` (the
raw URL string) + `angle`. Mode B then Serper-searches the raw URL string
(`runModeB.ts:44`) and feeds the URL string to the LLM. Paid output is generated
without the article's substance — an expectation gap on a paid feature.

## Decision

Reuse the existing `/api/url-preview` (open-graph-scraper) content the client
already fetches for display. Forward the resolved `{title, description, host,
kind}` to both the free preview and the paid generation, and use it to ground
Mode B. Applies to Hot Take (mode 1) only.

- **Fetch source:** client forwards the preview it already fetched (no extra
  request). Title/description are only LLM prompt context — no money/security
  surface — so client-supplied is acceptable (the user can already type any
  `eventDescription`).
- **Preview parity:** same `eventContext` goes to `/api/preview` and the stream,
  so the free preview reflects what the paid run will produce.

## Components

### `lib/eventContext.ts` (new, pure, tested)
```ts
export interface EventContext { title?: string; description?: string; host?: string; kind?: string }
export function composeEvent(eventDescription: string, ctx?: EventContext | null):
  { event: string; query: string }
```
- With `ctx.title`: `event = "<title> — <description> (source: <host>)"` (parts
  omitted when absent); `query = title`.
- Without usable `ctx`: `event = eventDescription`, `query = eventDescription`
  (preserves today's behaviour). Whitespace-only title is treated as absent.

### Client — `components/HotTakeInput.tsx`
- Wire `UrlPreviewCard`'s existing `onResolved` to capture the preview into state.
- Add `eventContext: EventContext | null` to `HotTakeSubmitPayload`, set only
  when the input is a URL and the preview resolved with a title/description.

### Plumbing (carry `eventContext` through, all optional)
- `HomeClient` → `beginFlow` + `startGen`; `PreviewArgs` (mode 1); `StreamRequest`.
- `lib/previewClient.ts`, `app/api/preview/route.ts`, `app/api/generate/stream/route.ts`.
- `hooks/useThreadGeneration.ts` `StartParams`.

### Mode B — `lib/pipeline/modes/hotTake.ts`
- `run` and `preview` call `composeEvent(eventDescription, eventContext)` and use
  `event` for the LLM prompt + CoinGecko, `query` for Serper.

## Out of scope
- Mode A / Mode 2 (no URL input).
- Server-side re-fetch of URLs (rejected: extra latency + SSRF surface; the
  client already has the OG content).
- Tweet links: OG scraping of x.com typically fails → silent fallback to URL
  text (today's behaviour; `UrlPreviewCard` already shows an honest fallback note).
- Review #4 (preview-vs-paid "unlock" regeneration copy) — separate issue.

## Testing
- `lib/eventContext.test.ts` (TDD): title+description+host, title-only,
  no-context fallback, whitespace-only title, empty description.
- `app/api/preview/route.test.ts`: `eventContext` reaches the mode-1 `PreviewInput`.
- `pnpm test:lib` + `pnpm build` + `pnpm lint` green. Paid/preview UI is gated
  behind a wallet + payment, so it's verified by tests + reasoning, not a live
  screenshot.

## Files touched
- `lib/eventContext.ts` (new) + `lib/eventContext.test.ts` (new)
- `components/HotTakeInput.tsx`
- `app/HomeClient.tsx`
- `lib/previewClient.ts`
- `app/api/preview/route.ts` (+ test)
- `app/api/generate/stream/route.ts`
- `hooks/useThreadGeneration.ts`
- `lib/pipeline/modes/hotTake.ts`
- `lib/pipeline/modes/types.ts` (PreviewInput gains optional eventContext)

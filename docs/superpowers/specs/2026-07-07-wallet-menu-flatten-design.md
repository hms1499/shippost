# Wallet Menu Flatten — Design

**Date:** 2026-07-07
**Status:** Approved, ready for implementation
**Goal:** The connected-wallet chip's bottom sheet buries its two real user needs — disconnect and history — behind extra hops. Disconnect takes 3 taps across two UI systems (sheet → "manage →" → RainbowKit account modal), and history isn't in the menu at all (footer only). Flatten the sheet so every action is one tap inside it, in the terminal theme, and drop the RainbowKit account modal entirely.

## Component: `components/WalletMenu.tsx` (only file that changes)

Sheet contents after the change, top to bottom:

1. **Address card** — same layout, but "manage →" becomes **"copy"**: writes the full address via `navigator.clipboard.writeText`, flips to "copied ✓" (primary color) for ~1.5 s, then reverts. Sheet stays open. "Connected via …" line unchanged.
2. **My History** — new row, `History` icon, `<Link href="/history">`, closes the sheet on tap. The footer ColophonIndex link stays — two entries to the same page is fine.
3. **Switch chain** — existing row, logic unchanged (only when off-target chain and not MiniPay).
4. **Disconnect** — new last row, destructive styling, `LogOut` icon, calls wagmi `useDisconnect().disconnect()` and closes the sheet. **Web only (`!isMiniPay`)**: in MiniPay the wallet is the host app, there is nothing to sign out of, and the auto-connect guard in HomeClient runs once per load so a disconnected MiniPay session would wedge the chip at "Connecting MiniPay…" until reload. This mirrors the existing rule of never offering switchChain inside MiniPay.

`openAccountModal` is removed from the destructure — no path into the RainbowKit account modal remains. On web, post-disconnect the chip falls back to the existing "Sign in" state.

## Decisions taken during brainstorm

- Actions in sheet: My History, one-tap Disconnect, Copy address. **No balance display** (skips 1–3 RPC reads per open; keeps the sheet instant).
- Approach chosen: flatten the existing sheet (keeps its animation, focus restore, Esc, scroll lock, backdrop) over an anchored popover (new component, worse touch targets) or a no-menu chip (undiscoverable long-press).

## Error handling

`navigator.clipboard` can reject (unfocused document, old webviews): catch and fall back to a temporary `textarea` + `document.execCommand('copy')`; if that also fails, show nothing rather than a broken state. Disconnect needs no special handling — wagmi clears state synchronously and the chip re-renders.

## Testing / verification

Repo has no component-test harness (all 328 Vitest tests are `.ts` logic tests) and this change is UI-only, so no new test files. Verification: `pnpm lint` + `pnpm build`, browser smoke of the pre-connect branch, and on-device MiniPay confirmation of the connected sheet by the user (same protocol as the Agent Terminal retheme).

## Out of scope

- Balance rows in the sheet (declined).
- Any change to HomeClient auto-connect, footer navigation, or `/history` page.
- RainbowKit connect modal for the pre-connect "Sign in" flow (unchanged — only the *account* modal goes away).

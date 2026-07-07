---
name: verify
description: How to runtime-verify CoinOp UI/flow changes — dev server + Playwright with a mocked MiniPay/web wallet provider, since connected-state UI needs an injected EIP-1193 wallet.
---

# Verifying CoinOp changes at runtime

## Launch

```bash
pnpm dev --port 3111   # ready in ~2s; run in background
```

Mobile viewport matters (MiniPay webview): `page.setViewportSize({ width: 390, height: 844 })`.

## Reaching connected-state UI (the main unlock)

Wallet UI (chip, bottom sheet, pay flow) only renders connected when an
injected EIP-1193 provider exists. Mock it via `page.addInitScript` **before**
`page.goto`:

```js
window.ethereum = {
  isMiniPay: true, // true → MiniPay branch (auto-connect fires); false → web branch
  request: async ({ method }) => {
    switch (method) {
      case 'eth_requestAccounts':
      case 'eth_accounts': return ['0x64Ad61211C1b0B7f20B3e04B49661f30f152ae78'];
      case 'eth_chainId': return '0xa4ec'; // 42220 Celo mainnet
      case 'net_version': return '42220';
      case 'wallet_switchEthereumChain': return null;
      default: throw new Error('mock: unsupported ' + method);
    }
  },
  on: () => {}, removeListener: () => {},
};
```

- `isMiniPay: true` → HomeClient auto-connects on load (~3s wait), chip shows
  "via MiniPay". Detection is `window.ethereum.isMiniPay` (`lib/minipay.ts`).
- Web branch without re-mocking: after a MiniPay session, add a second init
  script that `Object.defineProperty(window.ethereum, 'isMiniPay', { value: false })`
  and reload — wagmi reconnects from localStorage, chip shows "via Browser Wallet".
- Balance/contract reads go through HTTP RPC transports (real mainnet forno),
  NOT the mocked provider — read-only, safe, and they show live balances.
- Anything that would sign/send (pay flow) will throw in the mock — fine for
  UI verification, do not try to drive a real payment this way.

## Gotchas

- Two "My History" links exist (wallet sheet + footer ColophonIndex) — scope
  locators to `page.getByRole('dialog')`.
- The wallet sheet is `role="dialog"`; the chip is
  `getByRole('button', { name: 'Open account menu' })`.
- Clipboard asserts need `page.context().grantPermissions(['clipboard-read', 'clipboard-write'])`.
- Don't save screenshots into the repo root (iCloud-synced Desktop) — use the
  scratchpad or delete after reading.

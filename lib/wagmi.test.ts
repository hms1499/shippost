import { describe, it, expect } from 'vitest';
import { wagmiConfig } from './wagmi';

// MiniPay only surfaces window.ethereum (EIP-1193, no EIP-6963 announcement),
// so auto-connect in HomeClient depends on a connector with id 'injected'
// existing in the config. RainbowKit's default wallet list does not include
// one — it must be added explicitly.
describe('wagmiConfig', () => {
  it('exposes an injected connector for MiniPay auto-connect', () => {
    const ids = wagmiConfig.connectors.map((c) => c.id);
    expect(ids).toContain('injected');
  });
});

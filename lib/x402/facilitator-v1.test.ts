import { describe, it, expect } from 'vitest';
import type { FacilitatorClient } from '@x402/core/server';
import { V1DowngradeFacilitator, type PaymentPayload, type PaymentRequirements } from './facilitator-v1';

const CAIP2 = 'eip155:42220';
const V1_NETWORK = 'celo';
const RESOURCE_URL = 'https://shippost-kappa.vercel.app/api/x402/groq';
const USDC = '0xcebA9300f2b948710d2653dD7B07f33A8B32118C';
const PAY_TO = '0x006cBA3012139C299Aa4A522697B4A0c49F38895';

// The EIP-3009 authorization the client signed. The whole point of the
// downgrade is that this survives it untouched, so tests assert on identity.
const SIGNED_PAYLOAD = {
  signature: '0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8',
  authorization: {
    from: '0x64ad61211c1b0b7f20b3e04b49661f30f152ae78',
    to: PAY_TO,
    value: '1000',
    validAfter: '1740672089',
    validBefore: '4102444800',
    nonce: '0xf3746613c2d920b5fdabc0856f2aeb2d4f88ee6037b8cc5d04a71a4462f13480',
  },
};

function v2Payload(network = CAIP2): PaymentPayload {
  return {
    x402Version: 2,
    resource: { url: RESOURCE_URL, description: 'Groq completion', mimeType: 'application/json' },
    accepted: {
      scheme: 'exact',
      network,
      amount: '1000',
      asset: USDC,
      payTo: PAY_TO,
      maxTimeoutSeconds: 60,
      extra: { name: 'USDC', version: '2' },
    },
    payload: SIGNED_PAYLOAD,
  } as PaymentPayload;
}

function v2Requirements(network = CAIP2): PaymentRequirements {
  return {
    scheme: 'exact',
    network,
    amount: '1000',
    asset: USDC,
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
    extra: { name: 'USDC', version: '2' },
  } as PaymentRequirements;
}

/** Records what the shim actually put on the wire. */
function recorder() {
  const calls: { payload: PaymentPayload; requirements: PaymentRequirements }[] = [];
  const inner: FacilitatorClient = {
    async verify(payload, requirements) {
      calls.push({ payload, requirements });
      return { isValid: true, payer: SIGNED_PAYLOAD.authorization.from };
    },
    async settle(payload, requirements) {
      calls.push({ payload, requirements });
      return { success: true, transaction: '0xdeadbeef', network: V1_NETWORK as `${string}:${string}` };
    },
    async getSupported() {
      return { kinds: [], extensions: [], signers: {} };
    },
  };
  return { inner, calls };
}

function shim(inner: FacilitatorClient) {
  return new V1DowngradeFacilitator(inner, {
    caip2: CAIP2,
    v1Network: V1_NETWORK,
    resourceUrl: RESOURCE_URL,
  });
}

describe('V1DowngradeFacilitator', () => {
  it('verify: sends x402Version 1 and the bare network name, signed payload untouched', async () => {
    const { inner, calls } = recorder();

    await shim(inner).verify(v2Payload(), v2Requirements());

    const sent = calls[0].payload as unknown as Record<string, unknown>;
    expect(sent.x402Version).toBe(1);
    expect(sent.network).toBe('celo');
    expect(sent.scheme).toBe('exact');
    // v1 has no `accepted`/`resource` envelope — those are v2 only.
    expect(sent.accepted).toBeUndefined();
    // The signature commits to the token's EIP-712 domain, not the x402
    // network string, so it must cross the downgrade byte-identical.
    expect(sent.payload).toEqual(SIGNED_PAYLOAD);
  });

  it('verify: renames amount to maxAmountRequired and supplies the v1 resource fields', async () => {
    const { inner, calls } = recorder();

    await shim(inner).verify(v2Payload(), v2Requirements());

    const sent = calls[0].requirements as unknown as Record<string, unknown>;
    expect(sent.maxAmountRequired).toBe('1000');
    expect(sent.amount).toBeUndefined();
    expect(sent.network).toBe('celo');
    // v1 requires these; v2 hoisted them out of requirements onto the payload.
    expect(sent.resource).toBe(RESOURCE_URL);
    expect(typeof sent.description).toBe('string');
    expect(sent.mimeType).toBe('application/json');
    // Everything the facilitator actually settles against must survive intact —
    // a wrong asset or payTo would only surface as a failed settle.
    expect(sent.asset).toBe(USDC);
    expect(sent.payTo).toBe(PAY_TO);
    expect(sent.scheme).toBe('exact');
    expect(sent.maxTimeoutSeconds).toBe(60);
    expect(sent.extra).toEqual({ name: 'USDC', version: '2' });
  });

  it('settle: downgrades the same way verify does', async () => {
    const { inner, calls } = recorder();

    await shim(inner).settle(v2Payload(), v2Requirements());

    const payload = calls[0].payload as unknown as Record<string, unknown>;
    const requirements = calls[0].requirements as unknown as Record<string, unknown>;
    expect(payload.x402Version).toBe(1);
    expect(payload.network).toBe('celo');
    expect(requirements.network).toBe('celo');
    expect(requirements.maxAmountRequired).toBe('1000');
  });

  it('settle: reports the settled network back as CAIP-2, never the bare name', async () => {
    const { inner } = recorder();

    const result = await shim(inner).settle(v2Payload(), v2Requirements());

    // The bare name is an artefact of this shim. Letting it escape would put
    // `network: "celo"` into the X-PAYMENT-RESPONSE the caller reads back.
    expect(result.network).toBe(CAIP2);
    expect(result.transaction).toBe('0xdeadbeef');
    expect(result.success).toBe(true);
  });

  it('getSupported: advertises the v2 CAIP-2 kind even when the facilitator lists only v1', async () => {
    const { inner } = recorder();
    inner.getSupported = async () => ({
      kinds: [{ x402Version: 1, scheme: 'exact', network: V1_NETWORK as `${string}:${string}` }],
      extensions: [],
      signers: {},
    });

    const supported = await shim(inner).getSupported();

    // x402ResourceServer.buildPaymentRequirements throws "Facilitator does not
    // support exact on eip155:42220" unless this kind is present — so a Celo
    // fix that removes the v2 kind instead of implementing it would break the
    // 402 challenge, not just settlement.
    expect(supported.kinds).toContainEqual(
      expect.objectContaining({ x402Version: 2, scheme: 'exact', network: CAIP2 }),
    );
  });

  it('refuses to downgrade a payment for a different chain', async () => {
    const { inner } = recorder();

    // A second registered network must not be silently rewritten to Celo and
    // settled on the wrong chain.
    await expect(
      shim(inner).verify(v2Payload('eip155:8453'), v2Requirements('eip155:8453')),
    ).rejects.toThrow(/eip155:8453/);
  });
});

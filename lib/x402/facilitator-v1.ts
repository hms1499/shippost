import type { FacilitatorClient } from '@x402/core/server';

// @x402/core declares the payment types but re-exports none of them from any
// entrypoint, so take them off the interface this class implements. They then
// cannot drift from the methods they have to satisfy.
export type PaymentPayload = Parameters<FacilitatorClient['verify']>[0];
export type PaymentRequirements = Parameters<FacilitatorClient['verify']>[1];
type VerifyResponse = Awaited<ReturnType<FacilitatorClient['verify']>>;
type SettleResponse = Awaited<ReturnType<FacilitatorClient['settle']>>;
type SupportedResponse = Awaited<ReturnType<FacilitatorClient['getSupported']>>;

export interface V1DowngradeOptions {
  /** The CAIP-2 id everything above this shim speaks, e.g. `eip155:42220`. */
  caip2: string;
  /** The bare name the facilitator answers to, e.g. `celo`. */
  v1Network: string;
  /** Resource URL for the v1 `resource` field, which v2 moved off requirements. */
  resourceUrl: string;
}

/**
 * Speaks x402 v1 to a facilitator that only serves v1, while everything above
 * it keeps speaking v2.
 *
 * The Celo hosted facilitator advertises `(x402Version 2, eip155:*)` in
 * `/supported` — and its own skill.md tells integrators to use it — but
 * `/verify` and `/settle` reject that kind with `unsupported_scheme` and serve
 * only `(1, <bare name>)`. See
 * `docs/superpowers/plans/2026-08-01-x402-celo-facilitator-findings.md` §4.
 *
 * The downgrade is safe because the EIP-3009 authorization the client signed
 * commits to the *token's* EIP-712 domain (name/version/chainId/verifyingContract),
 * not to the x402 network string — so rewriting the envelope cannot invalidate
 * a signature.
 *
 * Deliberately a translation layer and not a v1-native rewrite: Celo is
 * migrating x402 → MPP, so nothing outside this file may learn that v1 exists.
 * When the facilitator serves the v2 kind it advertises, delete this file and
 * hand `HTTPFacilitatorClient` straight to the resource server again.
 */
export class V1DowngradeFacilitator implements FacilitatorClient {
  constructor(
    private readonly inner: FacilitatorClient,
    private readonly opts: V1DowngradeOptions,
  ) {}

  async verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    return this.inner.verify(
      this.downgradePayload(paymentPayload),
      this.downgradeRequirements(paymentRequirements, paymentPayload),
    );
  }

  async settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const settled = await this.inner.settle(
      this.downgradePayload(paymentPayload),
      this.downgradeRequirements(paymentRequirements, paymentPayload),
    );
    // Put the CAIP-2 id back: the bare name is an artefact of the wire format,
    // and this response is echoed to the caller in X-PAYMENT-RESPONSE.
    return { ...settled, network: this.opts.caip2 as `${string}:${string}` };
  }

  // The resource server refuses to build a 402 challenge for a network the
  // facilitator does not advertise under x402Version 2. Celo happens to
  // advertise that kind today and reject it at /verify; if it ever squares the
  // two by dropping the kind instead of serving it, the challenge would break
  // even though this shim can settle fine. So state the kind ourselves rather
  // than depend on which side of its own contradiction the facilitator lands.
  async getSupported(): Promise<SupportedResponse> {
    const supported = await this.inner.getSupported();
    const schemes = new Set(supported.kinds.map((k) => k.scheme));
    const synthesized = [...schemes]
      .filter(
        (scheme) =>
          !supported.kinds.some(
            (k) => k.x402Version === 2 && k.network === this.opts.caip2 && k.scheme === scheme,
          ),
      )
      .map((scheme) => ({
        x402Version: 2,
        scheme,
        network: this.opts.caip2 as `${string}:${string}`,
      }));
    return { ...supported, kinds: [...supported.kinds, ...synthesized] };
  }

  // v2 carries scheme/network on `accepted` and wraps the resource; v1 puts
  // scheme/network at the top level and knows neither.
  private downgradePayload(payload: PaymentPayload): PaymentPayload {
    const v2 = payload as unknown as {
      accepted: { scheme: string; network: string };
      payload: Record<string, unknown>;
    };
    // One shim, one chain. Rewriting another network's payment to this one
    // would settle real money on the wrong chain, and the facilitator has no
    // way to tell it was not meant.
    if (v2.accepted.network !== this.opts.caip2) {
      throw new Error(
        `x402 v1 downgrade is configured for ${this.opts.caip2}, refusing a payment on ${v2.accepted.network}`,
      );
    }
    return {
      x402Version: 1,
      scheme: v2.accepted.scheme,
      network: this.opts.v1Network,
      payload: v2.payload,
    } as unknown as PaymentPayload;
  }

  // v2 renamed `maxAmountRequired` to `amount` and moved the resource metadata
  // onto the payload. v1 wants all of it back on the requirements, and rejects
  // the body outright if `resource` is missing.
  private downgradeRequirements(
    requirements: PaymentRequirements,
    payload: PaymentPayload,
  ): PaymentRequirements {
    const { amount, network: _network, ...rest } = requirements as unknown as {
      amount: string;
      network: string;
    } & Record<string, unknown>;
    const resource = (payload as unknown as { resource?: { url?: string; description?: string; mimeType?: string } })
      .resource;
    return {
      ...rest,
      network: this.opts.v1Network,
      maxAmountRequired: amount,
      resource: resource?.url ?? this.opts.resourceUrl,
      description: resource?.description ?? '',
      mimeType: resource?.mimeType ?? 'application/json',
    } as unknown as PaymentRequirements;
  }
}

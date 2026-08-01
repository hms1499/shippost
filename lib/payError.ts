/**
 * Turn whatever the wallet threw into one line a user can read out loud.
 *
 * The payment path is the only place where a failure is unrecoverable without
 * the user's help: it happens inside the MiniPay webview, leaves no server log
 * (nothing was ever sent), and the wallet's own error is the single piece of
 * evidence that says why. Canned copy alone loses it, so the exact string is
 * kept and shown — see the first-payment failure where the approve lands and
 * `payForThread` never opens a sheet.
 */

const MAX_LEN = 300;

interface ErrorLike {
  shortMessage?: string;
  message?: string;
  name?: string;
  details?: string;
  code?: number | string;
  cause?: unknown;
}

function asErrorLike(e: unknown): ErrorLike | null {
  return typeof e === 'object' && e !== null ? (e as ErrorLike) : null;
}

/** EIP-1193 codes live on the error or one level down on `cause`. */
function findCode(e: ErrorLike): number | string | undefined {
  if (e.code !== undefined) return e.code;
  const cause = asErrorLike(e.cause);
  return cause?.code;
}

export function describePayError(e: unknown): string {
  if (typeof e === 'string' && e.trim()) return e.slice(0, MAX_LEN);

  const err = asErrorLike(e);
  if (!err) return 'Payment failed (unknown error)';

  const head = err.shortMessage ?? err.message;
  if (!head) return 'Payment failed (unknown error)';

  let out = head;

  // `Error` and `TypeError` say nothing a reader doesn't already see; a viem or
  // wallet class name (UserRejectedRequestError, …) is the whole diagnosis.
  if (err.name && err.name !== 'Error' && !head.includes(err.name)) {
    out += ` [${err.name}]`;
  }

  const code = findCode(err);
  if (code !== undefined && !out.includes(String(code))) {
    out += out.endsWith(']') ? ` code=${code}` : ` [code=${code}]`;
  }

  const details = asErrorLike(e)?.details ?? asErrorLike(err.cause)?.details;
  if (details && !out.includes(details)) {
    out += ` — ${details}`;
  }

  return out.length > MAX_LEN ? `${out.slice(0, MAX_LEN - 1)}…` : out;
}

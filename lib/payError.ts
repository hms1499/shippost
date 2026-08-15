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

function describeError(e: unknown, fallback: string): string {
  if (typeof e === 'string' && e.trim()) return e.slice(0, MAX_LEN);

  const err = asErrorLike(e);
  if (!err) return fallback;

  const head = err.shortMessage ?? err.message;
  if (!head) return fallback;

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

export function describePayError(e: unknown): string {
  return describeError(e, 'Payment failed (unknown error)');
}

/**
 * A failed chain switch, in one line.
 *
 * Two failures deserve canned copy because the wallet's own words are useless
 * to a user: a rejection (they know they rejected — what they need is the UI to
 * admit it happened) and a wallet that has no wallet_switchEthereumChain at all
 * (the action is impossible here, so the copy must point somewhere it is
 * possible). Everything else keeps the wallet's message, which is the only
 * evidence of what actually went wrong.
 */
export function describeSwitchError(e: unknown): string {
  const err = asErrorLike(e);
  if (err) {
    if (findCode(err) === 4001) return 'Switch declined in wallet.';
    if (err.name === 'SwitchChainNotSupportedError') {
      return "This wallet can't switch chains. Change network in the wallet, then reopen.";
    }
  }
  return describeError(e, 'Could not switch chain');
}

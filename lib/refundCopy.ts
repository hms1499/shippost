// The one place the refund promise is worded.
//
// It used to say "within 24h" in four separate hardcoded places (the
// refund-request response, ErrorSurface, HomeClient's partial-refund notice and
// PreviewLocked's pre-payment strip), and that turnaround was never something
// the system could honour: refunds are drained by a human running
// `pnpm refund:process`, and the on-chain `refund()` reverts outright while the
// payment contract's reserve is empty — Celo's is 0, Base's holds about two
// refunds. Promising a deadline to someone whose money is stuck is the worst
// possible moment to be optimistic, so the copy states the mechanism instead:
// queued, sent by hand, no schedule.
//
// Keep the route and the UI reading this same constant. Two copies of a promise
// drift, and the one that drifts is the one nobody re-reads.
// The mechanism on its own — the UI already says the request was received on
// the button itself, so it renders just this half.
export const REFUND_MANUAL_NOTE =
  'Refunds are sent by hand, not automatically, so this has no fixed turnaround.';

export const REFUND_QUEUED_MESSAGE = `Refund request received and queued. ${REFUND_MANUAL_NOTE}`;

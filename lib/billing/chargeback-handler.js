// Deterministic response plan for Stripe refund/dispute webhook events. Pure
// function: given the event's charge/dispute data, decides how many credits
// (if any) should be clawed back and whether the account should be flagged.
// The caller performs the actual DB writes.

export function planChargebackResponse({
  kind, // 'refund' | 'dispute_created' | 'dispute_closed'
  disputeStatus, // Stripe dispute.status, only relevant for dispute_closed
  creditsGrantedForPayment,
  creditsAlreadyConsumed,
}) {
  if (!['refund', 'dispute_created', 'dispute_closed'].includes(kind)) {
    throw new Error(`Unknown chargeback kind: ${kind}`);
  }

  const creditsRemaining = Math.max(0, (creditsGrantedForPayment || 0) - (creditsAlreadyConsumed || 0));

  if (kind === 'refund') {
    return {
      clawBackCredits: creditsRemaining,
      flagAccount: false,
      note: 'Refund issued: unused credits clawed back.',
    };
  }

  if (kind === 'dispute_created') {
    // Freeze remaining unused credits immediately; do not wait for resolution.
    return {
      clawBackCredits: creditsRemaining,
      flagAccount: true,
      note: 'Dispute opened: unused credits frozen pending resolution.',
    };
  }

  // dispute_closed
  if (disputeStatus === 'won') {
    return {
      clawBackCredits: 0,
      flagAccount: false,
      restoreCredits: creditsRemaining,
      note: 'Dispute won: credits restored.',
    };
  }
  return {
    clawBackCredits: creditsRemaining,
    flagAccount: true,
    note: `Dispute closed as ${disputeStatus}: credits remain clawed back, account flagged.`,
  };
}

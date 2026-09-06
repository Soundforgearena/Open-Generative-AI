export function paymentFeeCents(amountCents, { fixedFeeCents = 30, variableRateBps = 290, internationalSurchargeBps = 0, currencyConversionBps = 0, disputeReserveBps = 0 } = {}) {
  return Math.round(fixedFeeCents + (amountCents * (variableRateBps + internationalSurchargeBps + currencyConversionBps + disputeReserveBps)) / 10000);
}

export function amortizedFeeCents(purchaseAmountCents, creditsPurchased, creditsConsumed, model = {}) {
  if (creditsPurchased <= 0 || creditsConsumed <= 0) return 0;
  return Math.min(purchaseAmountCents, Math.round(paymentFeeCents(purchaseAmountCents, model) * creditsConsumed / creditsPurchased));
}

export function smallPurchaseAnalysis(amounts = [500, 1000, 2500, 5000, 10000, 25000], model) {
  return amounts.map((grossCents) => { const feeCents = paymentFeeCents(grossCents, model); return { grossCents, feeCents, feeBps: Math.round((feeCents * 10000) / grossCents), netCents: grossCents - feeCents }; });
}

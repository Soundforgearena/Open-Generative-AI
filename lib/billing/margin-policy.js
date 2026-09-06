export const MARGIN_POLICY = Object.freeze({
  version: '2026-09-06-v1',
  creditUsdCents: 1,
  targetContributionMarginBps: 6750,
  minimumContributionMarginBps: 6500,
  maximumTargetContributionMarginBps: 7000,
  defaultReservationBufferPercent: 12,
  paymentFeeModel: { fixedFeeCents: 30, variableRateBps: 290, allocationMethod: 'amortized-purchased-credit' },
  directOverheadByOperation: { 'ai-director': 1, storyboard: 2, transcription: 3, alignment: 3, stem_separation: 5, video_generation: 8, premium_video_generation: 12, lip_sync: 8, continuity_qa: 2, render_export: 5, paid_retake: 4 },
  riskReserveByOperation: { 'ai-director': 3, storyboard: 4, transcription: 5, alignment: 5, stem_separation: 8, video_generation: 10, premium_video_generation: 12, lip_sync: 10, continuity_qa: 5, render_export: 6, paid_retake: 8 },
  operationTargetsBps: { 'ai-director': 6500, storyboard: 6750, transcription: 6750, alignment: 6750, stem_separation: 7000, video_generation: 6750, premium_video_generation: 6500, lip_sync: 7000, continuity_qa: 6750, render_export: 6750, paid_retake: 7000 },
  packageDiscountGuardrails: { minimumRealizedMarginBps: 6500, maximumBonusPercent: 12, requireSimulationBeforePublish: true },
});

export function targetMarginBps(operation) { return MARGIN_POLICY.operationTargetsBps[operation] || MARGIN_POLICY.targetContributionMarginBps; }

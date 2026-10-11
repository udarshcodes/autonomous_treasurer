/**
 * Comms, payouts and story — owner: AI 5.
 *   explainApproval        approval card text, numbers inserted by code        (C4 card)
 *   findNudgeTargets       who owes money right now                            (C1)
 *   draftMemberNudge       nudge to an unpaid team member                       (C1)
 *   draftSponsorReminder   overdue sponsor invoice reminder text                (C2)
 *   parsePrizeList         CSV or free-text winners list -> rows               (C5)
 *   buildPrizeBatchPreview validate against registrations, exact PayPal batch  (C5)
 *   prizePreviewToProposal hand-off to the policy engine                        (C5)
 */
export * from "./slots";
export * from "./explainer";
export * from "./teams";
export * from "./nudges";
export * from "./prizes/csv";
export * from "./prizes/parse";
export * from "./prizes/preview";

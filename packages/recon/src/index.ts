/**
 * Reconciliation and data — owner: AI 4.
 *  - Seed script: 300 registrations with planted errors (src/seed/cli.ts, `npm run seed`)
 *  - Deterministic matcher (IDs, custom_id, amounts) first; LLM explainer only for the residue
 *  - Nightly Transaction Search cross-check (called by apps/worker)
 *  - Recon eval and the closing statement (S5)
 */

export interface MatchResult {
  ledgerEntryId: string;
  status: "matched" | "flagged" | "suggested" | "unmatched";
  matchedTo?: { type: string; id: string };
  explanation?: string;
}

// TODO(AI 4): matchLedger(eventId), explainUnmatched(items), nightlyCrossCheck(date), closingStatement(eventId).

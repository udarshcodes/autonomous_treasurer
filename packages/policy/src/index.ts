/**
 * Policy engine — owner: AI 3 (hard rules, YAML loader, tier routing, AI intent check)
 * and Dev 1 (execution path to PayPal).
 *
 * The ONLY path from a SpendProposal to a PayPal money-moving call runs through here.
 * Hard rules are plain code with unit tests; no prompt can talk around them.
 */
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import type { PolicyDecision, SpendProposal } from "@treasurer/shared";

export const PolicyDocument = z.object({
  currency: z.string().default("USD"),
  approval_tiers: z.array(
    z.object({
      /** Upper bound in USD (whole dollars in the YAML for readability). */
      max: z.number().positive(),
      approvers: z.array(z.enum(["treasurer", "faculty_advisor", "organizer"])),
    }),
  ),
  per_transaction_cap: z.number().positive(),
  daily_auto_approve_cap: z.number().nonnegative(),
  recipients: z.object({
    allow: z.array(z.enum(["registered_volunteers", "allowlisted_vendors", "confirmed_winners", "registrants"])),
  }),
  duplicate_window_days: z.number().int().positive(),
});
export type PolicyDocument = z.infer<typeof PolicyDocument>;

export function loadPolicyFile(path: string): PolicyDocument {
  return PolicyDocument.parse(parse(readFileSync(path, "utf8")));
}

/** Structured state the rules check against. Never free text. */
export interface PolicyContext {
  policy: PolicyDocument;
  budgetLine: { id: string; allocatedCents: number; spentCents: number };
  /** Emails allowed per recipient kind, from the database. */
  allowedRecipients: Record<string, Set<string>>;
  autoApprovedTodayCents: number;
}

export interface PolicyEngine {
  evaluate(proposal: SpendProposal, ctx: PolicyContext): Promise<PolicyDecision>;
}

// TODO(AI 3): implement hard rules (per-transaction cap, budget line cap, recipient rules,
// daily outflow cap, duplicate guard, refund bound), tier routing and the AI intent check.
// TODO(Dev 1): executeApproved(spendRequestId) -> PayPal payouts/refunds, ledger + audit writes.

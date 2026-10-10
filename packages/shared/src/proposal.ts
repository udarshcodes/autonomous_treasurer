import { z } from "zod";
import { ApproverRole, RecipientKind, SpendKind } from "./domain";

/**
 * THE CONTRACT between the agent (AI 1), the feature modules (AI 2, AI 4, AI 5)
 * and the policy engine (AI 3 / Dev 1).
 *
 * Anything that wants money to move produces a SpendProposal. It is only a proposal:
 * the policy engine checks hard rules, routes it to approvers, and alone calls PayPal.
 */

export const ProposalItem = z.object({
  /** Stable id for this line, used as PayPal sender_item_id / for idempotency. */
  itemId: z.string().min(1),
  recipientKind: RecipientKind,
  /** Internal id of the volunteer / vendor / registration member this pays. */
  recipientRef: z.string().min(1),
  /** PayPal receiver. Email only: the sandbox does not support PHONE. */
  recipientEmail: z.email(),
  amountCents: z.int().positive(),
  note: z.string().max(4000).optional(),
  /** For refunds: the PayPal capture being refunded. */
  captureId: z.string().optional(),
});
export type ProposalItem = z.infer<typeof ProposalItem>;

export const SpendProposal = z.object({
  eventId: z.string(),
  kind: SpendKind,
  budgetLineId: z.string(),
  /** Short human summary, e.g. "Prizes for 3 winning teams". Written by code, not the LLM. */
  title: z.string().max(200),
  items: z.array(ProposalItem).min(1),
  /** Pointers to the evidence: receipt ids, prize-list upload id, registration ids. */
  evidence: z.array(z.object({ type: z.string(), ref: z.string() })).default([]),
  /** Which component produced this proposal (for the audit log). */
  proposedBy: z.string(),
  /** Deterministic key so re-proposing the same thing is a no-op. */
  idempotencyKey: z.string().min(8),
});
export type SpendProposal = z.infer<typeof SpendProposal>;

export function proposalTotalCents(p: Pick<SpendProposal, "items">): number {
  return p.items.reduce((sum, item) => sum + item.amountCents, 0);
}

/** What the policy engine returns for a proposal. Consumed by the approval explainer and the UI. */
export const PolicyDecision = z.object({
  outcome: z.enum(["blocked", "auto_approved", "needs_approval"]),
  /** Hard-rule results, in evaluation order. */
  rules: z.array(
    z.object({
      rule: z.string(),
      passed: z.boolean(),
      detail: z.string(),
    }),
  ),
  /** AI intent / anomaly flags. Any flag forces human approval. */
  aiFlags: z.array(z.object({ code: z.string(), message: z.string() })).default([]),
  approvers: z.array(ApproverRole).default([]),
  tierMaxCents: z.int().nullable(),
});
export type PolicyDecision = z.infer<typeof PolicyDecision>;

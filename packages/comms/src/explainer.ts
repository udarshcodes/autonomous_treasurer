/**
 * Approval explainer — owner: AI 5.
 *
 * Turns a spend request plus budget state into the two-to-three line approval card.
 * Every figure on the card is computed here; the model only writes the wording
 * around {slots} and cannot insert a number of its own.
 */
import { z } from "zod";
import type { LlmClient } from "@treasurer/llm";
import { formatCents, type PolicyDecision, type SpendKind } from "@treasurer/shared";
import { draftWithSlots } from "./draft";
import { describeSlots, listToText, type Slots } from "./slots";

export interface ApprovalFactsInput {
  kind: SpendKind;
  /** Code-written summary, e.g. "Pizza for the volunteer dinner". */
  title: string;
  /** e.g. "Priya Shah (registered volunteer)" or "3 winning teams". */
  recipientSummary: string;
  amountCents: number;
  itemCount: number;
  budgetLine: { name: string; allocatedCents: number; spentCents: number };
  decision: PolicyDecision;
  /** Optional one-line evidence summary written by code, e.g. "Receipt from Tony's Pizza, 14 Oct". */
  evidenceSummary?: string;
}

export interface CardFact {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "bad";
}

export interface ApprovalCard {
  headline: string;
  body: string;
  facts: CardFact[];
  source: "llm" | "template";
  rejectedDrafts: string[];
}

const ROLE_NAMES: Record<string, string> = {
  treasurer: "the treasurer",
  faculty_advisor: "the faculty advisor",
  organizer: "the organizer",
};

const KIND_NAMES: Record<SpendKind, string> = {
  reimbursement: "reimbursement",
  vendor: "vendor payment",
  prize: "prize payout",
  refund: "refund",
};

/** All numbers for the card, computed in code. Exported for tests and for the UI. */
export function computeApprovalFacts(input: ApprovalFactsInput) {
  const { allocatedCents, spentCents } = input.budgetLine;
  const remainingBefore = allocatedCents - spentCents;
  const remainingAfter = remainingBefore - input.amountCents;
  const pctUsedAfter = allocatedCents > 0 ? Math.round(((spentCents + input.amountCents) / allocatedCents) * 100) : 100;
  const rulesPassed = input.decision.rules.filter((r) => r.passed).length;
  const approvers = input.decision.approvers.map((r) => ROLE_NAMES[r] ?? r);

  return {
    remainingBefore,
    remainingAfter,
    pctUsedAfter,
    overBudget: remainingAfter < 0,
    nearLimit: remainingAfter >= 0 && pctUsedAfter >= 90,
    rulesPassed,
    rulesTotal: input.decision.rules.length,
    approvers,
    flags: input.decision.aiFlags,
  };
}

const CardDraft = z.object({
  headline: z.string().describe("One line, under 90 characters, using slots for every figure and name."),
  body: z.string().describe("Two to three short sentences using slots for every figure and name."),
});

const SYSTEM = `You write approval cards for a student club's treasurer app. An approver reads the card on their phone and decides in seconds.

Write a headline and a body of two or three short sentences: what the money is for, which budget line it hits and what remains, and anything the approver should look at.

Hard rule: never write a digit, currency symbol, percentage, date, name or link yourself. Every figure and name must be a {slot} from the list provided. The app fills slots with exact values computed by the backend. A draft that contains a number typed by you is rejected.

Be plain and neutral. Do not recommend approving or rejecting. If there are AI flags, mention them plainly in the body. If the spend would overrun the budget line, say so.`;

export async function explainApproval(input: ApprovalFactsInput, llm?: LlmClient): Promise<ApprovalCard> {
  const f = computeApprovalFacts(input);

  const slots: Slots = {
    amount: formatCents(input.amountCents),
    kind: KIND_NAMES[input.kind],
    title: input.title,
    recipient: input.recipientSummary,
    item_count: String(input.itemCount),
    budget_line: input.budgetLine.name,
    remaining_before: formatCents(f.remainingBefore),
    remaining_after: formatCents(f.remainingAfter),
    overrun: formatCents(Math.max(0, -f.remainingAfter)),
    pct_used_after: `${f.pctUsedAfter}%`,
    approvers: listToText(f.approvers) || "no one (auto-approved)",
    flag_count: String(f.flags.length),
    flags: f.flags.map((x) => x.message).join("; "),
    evidence: input.evidenceSummary ?? "",
  };

  const facts: CardFact[] = [
    { label: "Amount", value: slots.amount! },
    { label: "Budget line", value: input.budgetLine.name },
    {
      label: "Remaining after",
      value: `${slots.remaining_after} (${slots.pct_used_after} used)`,
      tone: f.overBudget ? "bad" : f.nearLimit ? "warn" : "ok",
    },
    { label: "Approvers", value: slots.approvers! },
    {
      label: "Rule checks",
      value: `${f.rulesPassed} of ${f.rulesTotal} passed`,
      tone: f.rulesPassed === f.rulesTotal ? "ok" : "bad",
    },
  ];
  if (f.flags.length > 0) facts.push({ label: "AI flags", value: slots.flags!, tone: "warn" });

  // Blocked proposals never reach a human: no model call, just the rule that stopped it.
  if (input.decision.outcome === "blocked") {
    const failed = input.decision.rules.filter((r) => !r.passed);
    return {
      headline: `Blocked: ${slots.amount} ${slots.kind} to ${slots.recipient}`,
      body: `Stopped by ${failed.map((r) => `${r.rule} (${r.detail})`).join("; ")}. Nothing was sent to PayPal.`,
      facts,
      source: "template",
      rejectedDrafts: [],
    };
  }

  const fallback = {
    headline: "{amount} {kind} to {recipient}",
    body:
      (input.evidenceSummary ? "{title}. {evidence}. " : "{title}. ") +
      (f.overBudget
        ? "This would overrun the {budget_line} line by {overrun}. "
        : "Charged to {budget_line}, leaving {remaining_after} ({pct_used_after} used). ") +
      (f.flags.length > 0 ? "Flagged for review: {flags}." : "Needs approval from {approvers}."),
  };

  const situation = [
    `Spend type: ${KIND_NAMES[input.kind]}`,
    `Outcome so far: ${input.decision.outcome === "auto_approved" ? "auto-approved, card is informational" : "needs human approval"}`,
    `Budget state: ${f.overBudget ? "OVERRUNS the line" : f.nearLimit ? "uses most of what is left on the line" : "within the line"}`,
    `AI flags present: ${f.flags.length > 0 ? "yes" : "no"}`,
    `Evidence summary available: ${input.evidenceSummary ? "yes" : "no"}`,
  ].join("\n");

  const slotHelp = describeSlots({
    amount: "total amount of this spend",
    kind: "type of spend, e.g. 'reimbursement'",
    title: "what the money is for",
    recipient: "who receives the money",
    item_count: "number of payout items",
    budget_line: "budget line name",
    remaining_before: "amount left on the line before this spend",
    remaining_after: "amount left on the line after this spend (may be negative)",
    overrun: "how far over the line this spend goes (zero if within budget)",
    pct_used_after: "share of the line used after this spend",
    approvers: "who must approve",
    flag_count: "number of AI flags",
    flags: "the AI flag messages",
    ...(input.evidenceSummary ? { evidence: "one-line evidence summary" } : {}),
  });

  const result = await draftWithSlots({
    llm,
    request: {
      label: "comms.approval_explainer",
      tier: "fast",
      effort: "low",
      maxTokens: 2000,
      schema: CardDraft,
      system: SYSTEM,
      content: `Situation:\n${situation}\n\nSlots you may use:\n${slotHelp}`,
    },
    slots,
    required: { headline: ["amount"], body: ["budget_line"] },
    fallback,
    maxLength: { headline: 140, body: 420 },
  });

  return { ...result.text, facts, source: result.source, rejectedDrafts: result.rejected };
}

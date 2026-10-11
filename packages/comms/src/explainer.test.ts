import { describe, expect, it } from "vitest";
import { createFakeLlm } from "@treasurer/llm";
import type { PolicyDecision } from "@treasurer/shared";
import { computeApprovalFacts, explainApproval, type ApprovalFactsInput } from "./explainer";

const decision: PolicyDecision = {
  outcome: "needs_approval",
  rules: [
    { rule: "per_transaction_cap", passed: true, detail: "under $2,000" },
    { rule: "recipient_allowlist", passed: true, detail: "registered volunteer" },
  ],
  aiFlags: [],
  approvers: ["treasurer"],
  tierMaxCents: 50000,
};

const input: ApprovalFactsInput = {
  kind: "reimbursement",
  title: "Pizza for the volunteer dinner",
  recipientSummary: "Priya Shah (registered volunteer)",
  amountCents: 8640,
  itemCount: 1,
  budgetLine: { name: "Catering", allocatedCents: 150000, spentCents: 120000 },
  decision,
  evidenceSummary: "Receipt from Tony's Pizza",
};

describe("approval explainer", () => {
  it("computes budget impact in code", () => {
    const f = computeApprovalFacts(input);
    expect(f.remainingBefore).toBe(30000);
    expect(f.remainingAfter).toBe(21360);
    expect(f.pctUsedAfter).toBe(86);
    expect(f.overBudget).toBe(false);
  });

  it("uses the model's wording but code's numbers", async () => {
    const llm = createFakeLlm(() => ({
      headline: "{recipient} asks for {amount}",
      body: "{title}, charged to {budget_line}. That leaves {remaining_after} on the line. Needs {approvers}.",
    }));
    const card = await explainApproval(input, llm);
    expect(card.source).toBe("llm");
    expect(card.headline).toBe("Priya Shah (registered volunteer) asks for $86.40");
    expect(card.body).toContain("leaves $213.60 on the line");
    expect(card.facts.find((f) => f.label === "Remaining after")?.value).toBe("$213.60 (86% used)");
  });

  it("rejects a draft where the model typed a number, then falls back to the template", async () => {
    const llm = createFakeLlm(() => ({ headline: "Pay $86.40 now", body: "Catering has $300 left." }));
    const card = await explainApproval(input, llm);
    expect(card.source).toBe("template");
    expect(card.rejectedDrafts.length).toBe(2);
    expect(llm.calls.length).toBe(2);
    expect(card.headline).toBe("$86.40 reimbursement to Priya Shah (registered volunteer)");
    expect(card.body).toContain("leaving $213.60 (86% used)");
  });

  it("works with no LLM configured", async () => {
    const card = await explainApproval(input);
    expect(card.source).toBe("template");
    expect(card.body).toContain("Needs approval from the treasurer");
  });

  it("explains overruns and flags", async () => {
    const card = await explainApproval({
      ...input,
      amountCents: 40000,
      decision: { ...decision, aiFlags: [{ code: "line_mismatch", message: "pizza receipt claimed against Venue" }] },
    });
    expect(card.body).toContain("overrun the Catering line by $100.00");
    expect(card.body).toContain("pizza receipt claimed against Venue");
    expect(card.facts.find((f) => f.label === "Remaining after")?.tone).toBe("bad");
  });

  it("never calls the model for blocked proposals", async () => {
    const llm = createFakeLlm(() => {
      throw new Error("should not be called");
    });
    const card = await explainApproval(
      {
        ...input,
        amountCents: 90000,
        recipientSummary: "unknown account",
        decision: {
          ...decision,
          outcome: "blocked",
          rules: [{ rule: "recipient_allowlist", passed: false, detail: "payee is not a registered volunteer, vendor or winner" }],
        },
      },
      llm,
    );
    expect(card.headline).toBe("Blocked: $900.00 reimbursement to unknown account");
    expect(card.body).toContain("recipient_allowlist");
    expect(llm.calls.length).toBe(0);
  });
});

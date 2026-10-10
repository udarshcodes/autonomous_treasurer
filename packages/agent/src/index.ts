/**
 * Agent — owner: AI 1.
 *
 * Tool-calling loop over a small typed tool set:
 *  - read tools via the PayPal Agent Toolkit (read actions only)
 *  - propose_* tools that return a pending SpendProposal, never a completed action
 *  - plan-preview flow: every money-moving request becomes a plan the user confirms
 *
 * Feature modules expose functions the agent wraps as tools, e.g. from @treasurer/comms:
 *   parsePrizeList, buildPrizeBatchPreview, draftMemberNudge, draftSponsorReminder.
 */

export interface PlanStep {
  tool: string;
  args: Record<string, unknown>;
  summary: string;
}

export interface Plan {
  request: string;
  steps: PlanStep[];
  movesMoney: boolean;
}

// TODO(AI 1): agent loop, tool registry, plan preview, bulk refund job (S1).

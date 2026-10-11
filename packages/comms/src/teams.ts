/**
 * C1: find who still owes money. Deterministic; the LLM only writes the message.
 */

export interface MemberRecord {
  id: string;
  name: string;
  email: string;
  isLead: boolean;
  shareCents: number;
  paidCents: number;
  payToken: string;
  nudgesSent: number;
  lastNudgedAt: Date | null;
}

export interface TeamRecord {
  id: string;
  teamName: string;
  status: "pending" | "partially_paid" | "paid" | "refunded" | "cancelled";
  track?: string | null;
  members: MemberRecord[];
}

export type TeamPaymentState = "unpaid" | "partial" | "paid";

export interface TeamPaymentSummary {
  teamId: string;
  teamName: string;
  state: TeamPaymentState;
  teamSize: number;
  paidCount: number;
  outstandingCents: number;
  unpaidMembers: MemberRecord[];
  lead: MemberRecord | undefined;
}

export function summarizeTeam(team: TeamRecord): TeamPaymentSummary {
  const unpaidMembers = team.members.filter((m) => m.paidCents < m.shareCents);
  const paidCount = team.members.length - unpaidMembers.length;
  const outstandingCents = unpaidMembers.reduce((sum, m) => sum + (m.shareCents - m.paidCents), 0);
  return {
    teamId: team.id,
    teamName: team.teamName,
    state: unpaidMembers.length === 0 ? "paid" : paidCount === 0 && team.members.every((m) => m.paidCents === 0) ? "unpaid" : "partial",
    teamSize: team.members.length,
    paidCount,
    outstandingCents,
    unpaidMembers,
    lead: team.members.find((m) => m.isLead),
  };
}

export interface NudgePolicy {
  /** Do not nudge the same member more often than this. */
  cooldownHours: number;
  /** Stop after this many nudges; the treasurer follows up by hand. */
  maxNudges: number;
  /** Also nudge teams where nobody has paid yet (lead only). */
  includeUnpaidTeams: boolean;
}

export const DEFAULT_NUDGE_POLICY: NudgePolicy = { cooldownHours: 24, maxNudges: 3, includeUnpaidTeams: true };

export interface NudgeTarget {
  team: TeamPaymentSummary;
  member: MemberRecord;
  reason: "partial_team" | "unpaid_team";
}

export interface NudgeScan {
  partialTeams: TeamPaymentSummary[];
  unpaidTeams: TeamPaymentSummary[];
  targets: NudgeTarget[];
  skipped: Array<{ memberId: string; reason: "cooldown" | "max_nudges" }>;
}

/** Which members should get a nudge right now. */
export function findNudgeTargets(teams: TeamRecord[], now: Date, policy: NudgePolicy = DEFAULT_NUDGE_POLICY): NudgeScan {
  const scan: NudgeScan = { partialTeams: [], unpaidTeams: [], targets: [], skipped: [] };
  for (const team of teams) {
    if (team.status === "cancelled" || team.status === "refunded") continue;
    const summary = summarizeTeam(team);
    if (summary.state === "paid") continue;

    let candidates: MemberRecord[];
    let reason: NudgeTarget["reason"];
    if (summary.state === "partial") {
      scan.partialTeams.push(summary);
      candidates = summary.unpaidMembers;
      reason = "partial_team";
    } else {
      scan.unpaidTeams.push(summary);
      if (!policy.includeUnpaidTeams) continue;
      candidates = summary.lead ? [summary.lead] : summary.unpaidMembers.slice(0, 1);
      reason = "unpaid_team";
    }

    for (const member of candidates) {
      if (member.nudgesSent >= policy.maxNudges) {
        scan.skipped.push({ memberId: member.id, reason: "max_nudges" });
      } else if (member.lastNudgedAt && now.getTime() - member.lastNudgedAt.getTime() < policy.cooldownHours * 3_600_000) {
        scan.skipped.push({ memberId: member.id, reason: "cooldown" });
      } else {
        scan.targets.push({ team: summary, member, reason });
      }
    }
  }
  return scan;
}

/**
 * Prize batch preview — owner: AI 5 (C5).
 *
 * Validates a parsed prize list against registrations and builds the exact PayPal
 * Payouts batch that would be sent, plus the SpendProposal handed to the policy
 * engine. Nothing here moves money: the policy engine and an approver do that.
 */
import type { PayoutBatchRequest } from "@treasurer/paypal";
import {
  centsToPayPalValue,
  formatCents,
  splitCents,
  stableKey,
  type ProposalItem,
  type SpendProposal,
} from "@treasurer/shared";
import { ordinal } from "../slots";
import type { MemberRecord, TeamRecord } from "../teams";
import type { ParsedPrizeList, PrizeEntry } from "./parse";

export type IssueCode =
  | "team_not_found"
  | "team_ambiguous"
  | "team_not_eligible"
  | "duplicate_team"
  | "duplicate_place"
  | "amount_unreadable"
  | "amount_mismatch"
  | "recipient_not_in_team"
  | "no_recipients"
  | "over_budget"
  | "parse_warning";

export interface PreviewIssue {
  severity: "error" | "warning";
  code: IssueCode;
  line: number | null;
  message: string;
  /** e.g. the registered team name we think was meant. Never applied automatically. */
  suggestion?: string;
}

export interface PreviewItem {
  senderItemId: string;
  line: number;
  label: string;
  teamId: string;
  teamName: string;
  memberId: string;
  memberName: string;
  email: string;
  amountCents: number;
}

export interface PrizeBatchPreview {
  ok: boolean;
  senderBatchId: string;
  items: PreviewItem[];
  totalCents: number;
  winners: number;
  recipients: number;
  issues: PreviewIssue[];
  budget: { line: string; remainingBeforeCents: number; remainingAfterCents: number };
  /** The exact body for POST /v1/payments/payouts. */
  paypalRequest: PayoutBatchRequest;
}

export interface PreviewInput {
  event: { id: string; name: string };
  list: ParsedPrizeList;
  teams: TeamRecord[];
  budgetLine: { id: string; name: string; allocatedCents: number; spentCents: number };
  /** Official prize table, if the event has one: place -> amount. Mismatches are errors. */
  prizeTable?: Array<{ place: number; amountCents: number }>;
  /**
   * When the list gives no emails: pay the team lead the whole prize, or split it
   * equally between all members.
   */
  splitMode?: "lead" | "equal";
}

export function normaliseTeamName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/^team\s+/, "")
    .replace(/[^a-z0-9]/g, "");
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Dice coefficient on character bigrams of normalised names, 0..1. */
export function nameSimilarity(a: string, b: string): number {
  const x = normaliseTeamName(a);
  const y = normaliseTeamName(b);
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const bx = bigrams(x);
  const by = bigrams(y);
  let overlap = 0;
  for (const [g, n] of bx) overlap += Math.min(n, by.get(g) ?? 0);
  return (2 * overlap) / (x.length - 1 + (y.length - 1));
}

type TeamMatch =
  | { kind: "exact"; team: TeamRecord }
  | { kind: "ambiguous"; candidates: TeamRecord[] }
  | { kind: "none"; suggestion?: TeamRecord };

export function matchTeam(name: string, teams: TeamRecord[]): TeamMatch {
  const key = normaliseTeamName(name);
  const exact = teams.filter((t) => normaliseTeamName(t.teamName) === key);
  if (exact.length === 1) return { kind: "exact", team: exact[0]! };
  if (exact.length > 1) return { kind: "ambiguous", candidates: exact };
  const scored = teams
    .map((t) => ({ t, s: nameSimilarity(name, t.teamName) }))
    .filter((x) => x.s >= 0.75)
    .sort((a, b) => b.s - a.s);
  return { kind: "none", suggestion: scored[0]?.t };
}

function entryLabel(e: PrizeEntry): string {
  if (e.place !== null && e.category) return `${ordinal(e.place)} place, ${e.category}`;
  if (e.place !== null) return `${ordinal(e.place)} place`;
  return e.category ?? "Prize";
}

export function buildPrizeBatchPreview(input: PreviewInput): PrizeBatchPreview {
  const issues: PreviewIssue[] = input.list.warnings.map((w) => ({
    severity: "warning",
    code: "parse_warning",
    line: null,
    message: w,
  }));
  const items: PreviewItem[] = [];
  const seenTeams = new Map<string, number>();
  const seenPlaces = new Map<string, number>();
  const prizeByPlace = new Map(input.prizeTable?.map((p) => [p.place, p.amountCents]));

  for (const entry of input.list.entries) {
    const err = (code: IssueCode, message: string, suggestion?: string) =>
      issues.push({ severity: "error", code, line: entry.line, message, suggestion });

    // Amount: parsed by code from the source text.
    if (entry.amountCents === null || entry.amountCents <= 0) {
      err("amount_unreadable", `Line ${entry.line}: could not read amount "${entry.amountText}"`);
      continue;
    }
    if (entry.place !== null && prizeByPlace.has(entry.place) && prizeByPlace.get(entry.place) !== entry.amountCents) {
      err(
        "amount_mismatch",
        `Line ${entry.line}: ${ordinal(entry.place)} place is ${formatCents(prizeByPlace.get(entry.place)!)} in the prize table, list says ${formatCents(entry.amountCents)}`,
      );
    }

    // Same place twice within the same category.
    if (entry.place !== null) {
      const placeKey = `${entry.category ?? ""}#${entry.place}`;
      if (seenPlaces.has(placeKey)) {
        err("duplicate_place", `Line ${entry.line}: ${entryLabel(entry)} already given on line ${seenPlaces.get(placeKey)}`);
      } else seenPlaces.set(placeKey, entry.line);
    }

    // Team must match exactly one registration. Fuzzy matches are suggested, never applied.
    const match = matchTeam(entry.teamName, input.teams);
    if (match.kind === "ambiguous") {
      err("team_ambiguous", `Line ${entry.line}: "${entry.teamName}" matches ${match.candidates.length} registered teams`);
      continue;
    }
    if (match.kind === "none") {
      err(
        "team_not_found",
        `Line ${entry.line}: no registered team called "${entry.teamName}"` +
          (match.suggestion ? `. Did you mean "${match.suggestion.teamName}"?` : ""),
        match.suggestion?.teamName,
      );
      continue;
    }
    const team = match.team;
    if (team.status !== "paid") {
      err("team_not_eligible", `Line ${entry.line}: ${team.teamName} is ${team.status.replace("_", " ")}, not a confirmed registration`);
    }
    if (seenTeams.has(team.id)) {
      issues.push({
        severity: "warning",
        code: "duplicate_team",
        line: entry.line,
        message: `Line ${entry.line}: ${team.teamName} also won on line ${seenTeams.get(team.id)}. Check this is intended.`,
      });
    } else seenTeams.set(team.id, entry.line);

    // Recipients: listed emails must belong to this team's members (blocks "pay this other account").
    let recipients: MemberRecord[];
    if (entry.recipientEmails.length > 0) {
      recipients = [];
      for (const email of entry.recipientEmails) {
        const member = team.members.find((m) => m.email.toLowerCase() === email);
        if (member) recipients.push(member);
        else err("recipient_not_in_team", `Line ${entry.line}: ${email} is not a registered member of ${team.teamName}`);
      }
      if (recipients.length !== entry.recipientEmails.length) continue;
    } else if ((input.splitMode ?? "lead") === "lead") {
      const lead = team.members.find((m) => m.isLead) ?? team.members[0];
      recipients = lead ? [lead] : [];
    } else {
      recipients = [...team.members];
    }
    if (recipients.length === 0) {
      err("no_recipients", `Line ${entry.line}: ${team.teamName} has no members to pay`);
      continue;
    }

    const shares = splitCents(entry.amountCents, recipients.length);
    const label = entryLabel(entry);
    recipients.forEach((member, i) => {
      items.push({
        senderItemId: `prize-${stableKey(input.event.id, entry.line, entry.place, entry.category, member.id).slice(0, 16)}`,
        line: entry.line,
        label,
        teamId: team.id,
        teamName: team.teamName,
        memberId: member.id,
        memberName: member.name,
        email: member.email.toLowerCase(),
        amountCents: shares[i]!,
      });
    });
  }

  const totalCents = items.reduce((s, it) => s + it.amountCents, 0);
  const remainingBeforeCents = input.budgetLine.allocatedCents - input.budgetLine.spentCents;
  const remainingAfterCents = remainingBeforeCents - totalCents;
  if (remainingAfterCents < 0) {
    issues.push({
      severity: "error",
      code: "over_budget",
      line: null,
      message: `Total ${formatCents(totalCents)} exceeds what is left on ${input.budgetLine.name} (${formatCents(remainingBeforeCents)})`,
    });
  }

  // Same event + same items => same sender_batch_id, so PayPal rejects an accidental second send.
  const senderBatchId = `prizes-${stableKey(
    input.event.id,
    items.map((i) => [i.senderItemId, i.email, i.amountCents]),
  )}`;

  const paypalRequest: PayoutBatchRequest = {
    sender_batch_header: {
      sender_batch_id: senderBatchId,
      email_subject: `Your prize from ${input.event.name}`,
      email_message: `Congratulations! Your prize from ${input.event.name} is on its way.`,
    },
    items: items.map((it) => ({
      recipient_type: "EMAIL",
      receiver: it.email,
      amount: { value: centsToPayPalValue(it.amountCents), currency: "USD" },
      sender_item_id: it.senderItemId,
      note: `${it.label} at ${input.event.name}, team ${it.teamName}`,
      purpose: "PRIZES",
    })),
  };

  return {
    ok: items.length > 0 && !issues.some((i) => i.severity === "error"),
    senderBatchId,
    items,
    totalCents,
    winners: new Set(items.map((i) => `${i.line}`)).size,
    recipients: items.length,
    issues,
    budget: { line: input.budgetLine.name, remainingBeforeCents, remainingAfterCents },
    paypalRequest,
  };
}

/** Hand-off to the policy engine. Only call when preview.ok. */
export function prizePreviewToProposal(
  preview: PrizeBatchPreview,
  ctx: { eventId: string; budgetLineId: string; uploadId: string },
): SpendProposal {
  if (!preview.ok) throw new Error("Cannot propose a prize batch that has errors");
  const items: ProposalItem[] = preview.items.map((it) => ({
    itemId: it.senderItemId,
    recipientKind: "confirmed_winner",
    recipientRef: it.memberId,
    recipientEmail: it.email,
    amountCents: it.amountCents,
    note: `${it.label}, team ${it.teamName}`,
  }));
  const teams = new Set(preview.items.map((i) => i.teamId)).size;
  return {
    eventId: ctx.eventId,
    kind: "prize",
    budgetLineId: ctx.budgetLineId,
    title: `Prizes for ${teams} winning team${teams === 1 ? "" : "s"}`,
    items,
    evidence: [{ type: "prize_list_upload", ref: ctx.uploadId }],
    proposedBy: "comms.prize_batch_preview",
    idempotencyKey: preview.senderBatchId,
  };
}

/**
 * Nudge and reminder writer — owner: AI 5.
 *
 * Drafts short messages with tone control. Tone escalates in code from history,
 * not at the model's discretion. Sending goes through PayPal (invoice reminders)
 * or email; this module only drafts.
 */
import { z } from "zod";
import type { LlmClient } from "@treasurer/llm";
import { formatCents } from "@treasurer/shared";
import { draftWithSlots } from "./draft";
import { describeSlots, firstName, type Slots } from "./slots";
import type { NudgeTarget } from "./teams";

export type Tone = "friendly" | "reminder" | "final";

export interface DraftedMessage {
  to: string;
  subject: string;
  body: string;
  tone: Tone;
  source: "llm" | "template";
  rejectedDrafts: string[];
}

const MessageDraft = z.object({
  subject: z.string().describe("Email subject, under 70 characters, slots for every figure and name."),
  body: z.string().describe("Plain-text message body, slots for every figure, name, date and link."),
});

const TONE_GUIDE: Record<Tone, string> = {
  friendly: "Warm and light. Assume they forgot. One short paragraph.",
  reminder: "Polite and direct. Make the action and the deadline clear. One short paragraph.",
  final: "Courteous but firm. This is the last automated reminder; say what happens next. Two short paragraphs at most.",
};

const RULES = `Hard rule: never write a digit, currency symbol, date, name or link yourself. Use the {slots} listed; the app fills them with exact values. A draft containing a number typed by you is rejected.
No emojis, no exclamation marks in a final notice, no guilt-tripping, no threats. Do not invent consequences, discounts or deadlines that are not in the slots.`;

/* ------------------------------------------------------------------ */
/* C1: unpaid team members                                            */
/* ------------------------------------------------------------------ */

export function memberTone(nudgesSent: number): Tone {
  return nudgesSent <= 0 ? "friendly" : nudgesSent === 1 ? "reminder" : "final";
}

export interface MemberNudgeInput {
  target: NudgeTarget;
  eventName: string;
  /** Absolute payment link for this member, built by the API from member.payToken. */
  payLink: string;
  /** Human date, e.g. "Friday 17 October". Optional. */
  deadline?: string;
}

export async function draftMemberNudge(input: MemberNudgeInput, llm?: LlmClient): Promise<DraftedMessage> {
  const { team, member, reason } = input.target;
  const tone = memberTone(member.nudgesSent);
  const amountDue = member.shareCents - member.paidCents;
  const lead = team.lead && team.lead.id !== member.id ? team.lead : undefined;

  const slots: Slots = {
    first_name: firstName(member.name),
    event_name: input.eventName,
    team_name: team.teamName,
    lead_name: lead ? firstName(lead.name) : "",
    amount_due: formatCents(amountDue),
    team_outstanding: formatCents(team.outstandingCents),
    paid_count: String(team.paidCount),
    team_size: String(team.teamSize),
    pay_link: input.payLink,
    deadline: input.deadline ?? "",
  };

  const facts = [
    `Situation: ${reason === "partial_team" ? "some teammates have paid, this member has not" : "nobody on the team has paid yet; this member is the team lead"}`,
    `Tone: ${tone} — ${TONE_GUIDE[tone]}`,
    `Team lead known and different from recipient: ${lead ? "yes" : "no"}`,
    `Deadline known: ${input.deadline ? "yes" : "no"}`,
  ].join("\n");

  const slotHelp = describeSlots({
    first_name: "recipient's first name",
    event_name: "event name",
    team_name: "team name",
    ...(lead ? { lead_name: "team lead's first name" } : {}),
    amount_due: "what this member owes",
    team_outstanding: "what the whole team still owes",
    paid_count: "teammates who have paid",
    team_size: "team size",
    pay_link: "personal PayPal payment link (must appear in the body)",
    ...(input.deadline ? { deadline: "payment deadline" } : {}),
  });

  const fallback =
    reason === "partial_team"
      ? {
          subject: tone === "final" ? "Final reminder: your {event_name} fee" : "Your {event_name} spot: {amount_due} to go",
          body:
            "Hi {first_name},\n\n{paid_count} of {team_size} people on {team_name} have paid for {event_name}. " +
            "Your share is {amount_due}" +
            (input.deadline ? ", due by {deadline}" : "") +
            ". You can pay here: {pay_link}\n\n" +
            (tone === "final"
              ? "This is the last automatic reminder. Your team is confirmed once everyone has paid."
              : "Your team is confirmed once everyone has paid.") +
            "\n\nThanks!",
        }
      : {
          subject: tone === "final" ? "Final reminder: {team_name} registration" : "Finish registering {team_name}",
          body:
            "Hi {first_name},\n\n{team_name} is registered for {event_name} but no payment has come in yet. " +
            "The team owes {team_outstanding}" +
            (input.deadline ? ", due by {deadline}" : "") +
            ". You can pay your share here: {pay_link}\n\nThanks!",
        };

  const result = await draftWithSlots({
    llm,
    request: {
      label: "comms.member_nudge",
      tier: "fast",
      effort: "low",
      maxTokens: 2000,
      schema: MessageDraft,
      system: `You write short payment nudges for a student event's registration system.\n\n${RULES}`,
      content: `${facts}\n\nSlots you may use:\n${slotHelp}`,
    },
    slots,
    required: { body: ["pay_link", "amount_due"] },
    fallback,
    maxLength: { subject: 90, body: 900 },
  });

  return { to: member.email, ...result.text, tone, source: result.source, rejectedDrafts: result.rejected };
}

/* ------------------------------------------------------------------ */
/* C2: overdue sponsor invoices (text for PayPal's remind endpoint)    */
/* ------------------------------------------------------------------ */

export function sponsorTone(daysOverdue: number, remindersSent: number): Tone {
  if (daysOverdue <= 0 && remindersSent === 0) return "friendly";
  if (daysOverdue >= 14 || remindersSent >= 2) return "final";
  return "reminder";
}

export interface SponsorReminderInput {
  sponsorName: string;
  contactName?: string;
  eventName: string;
  invoiceNumber: string;
  amountCents: number;
  /** Human date, e.g. "10 October". */
  dueDate: string;
  daysOverdue: number;
  remindersSent: number;
  invoiceLink?: string;
  /** Deliverables the club owes the sponsor, e.g. ["logo on the website", "booth"]. Code-written. */
  deliverables?: string[];
}

export async function draftSponsorReminder(input: SponsorReminderInput, llm?: LlmClient): Promise<DraftedMessage & { note: string }> {
  const tone = sponsorTone(input.daysOverdue, input.remindersSent);
  const slots: Slots = {
    contact_name: input.contactName ? firstName(input.contactName) : "",
    sponsor_name: input.sponsorName,
    event_name: input.eventName,
    invoice_number: input.invoiceNumber,
    amount: formatCents(input.amountCents),
    due_date: input.dueDate,
    days_overdue: String(Math.max(0, input.daysOverdue)),
    invoice_link: input.invoiceLink ?? "",
    deliverables: (input.deliverables ?? []).join(", "),
  };

  const slotHelp = describeSlots({
    ...(input.contactName ? { contact_name: "sponsor contact's first name" } : {}),
    sponsor_name: "sponsor company",
    event_name: "event name",
    invoice_number: "invoice number",
    amount: "invoice amount",
    due_date: "invoice due date",
    ...(input.daysOverdue > 0 ? { days_overdue: "days past due" } : {}),
    ...(input.invoiceLink ? { invoice_link: "PayPal invoice link" } : {}),
    ...(input.deliverables?.length ? { deliverables: "what the club is delivering for the sponsor" } : {}),
  });

  const facts = [
    `Status: ${input.daysOverdue > 0 ? "past due" : "due soon or due today"}`,
    `Tone: ${tone} — ${TONE_GUIDE[tone]}`,
    `Reminders already sent: ${input.remindersSent > 0 ? "yes" : "none"}`,
    "Audience: a company sponsor; keep it professional and appreciative of their support.",
  ].join("\n");

  const greeting = input.contactName ? "Hi {contact_name}," : "Hello,";
  const fallback = {
    subject: input.daysOverdue > 0 ? "Invoice {invoice_number} for {event_name} is past due" : "Invoice {invoice_number} for {event_name}",
    body:
      `${greeting}\n\nThank you for sponsoring {event_name}. ` +
      (input.daysOverdue > 0
        ? "Invoice {invoice_number} for {amount} was due on {due_date} and is now {days_overdue} days past due. "
        : "A quick reminder that invoice {invoice_number} for {amount} is due on {due_date}. ") +
      (input.invoiceLink ? "You can pay it here: {invoice_link}" : "You can pay it from the PayPal invoice email.") +
      (input.deliverables?.length ? "\n\nWe're on track with {deliverables}." : "") +
      "\n\nThank you,\nThe organising team",
  };

  const result = await draftWithSlots({
    llm,
    request: {
      label: "comms.sponsor_reminder",
      tier: "fast",
      effort: "low",
      maxTokens: 2000,
      schema: MessageDraft,
      system: `You write invoice reminders from a student club to its event sponsors.\n\n${RULES}`,
      content: `${facts}\n\nSlots you may use:\n${slotHelp}`,
    },
    slots,
    required: { body: ["invoice_number", "amount"] },
    fallback,
    maxLength: { subject: 90, body: 1200 },
  });

  // PayPal's invoice reminder takes a subject and a note; the note is the body.
  return { to: "", ...result.text, note: result.text.body, tone, source: result.source, rejectedDrafts: result.rejected };
}

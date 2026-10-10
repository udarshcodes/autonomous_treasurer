/**
 * Data model — owner: Dev 1.
 *
 * Every money movement is a LedgerEntry linked to both its business object and its
 * PayPal object id, so reconciliation is a join, not a search.
 * Amounts are integer cents (bigint mode "number" is safe up to 2^53 cents).
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const cents = (name: string) => bigint(name, { mode: "number" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const spendKind = pgEnum("spend_kind", ["reimbursement", "vendor", "prize", "refund"]);
export const ledgerDirection = pgEnum("ledger_direction", ["in", "out"]);
export const reconStatus = pgEnum("recon_status", ["unmatched", "matched", "flagged", "suggested"]);
export const registrationStatus = pgEnum("registration_status", [
  "pending",
  "partially_paid",
  "paid",
  "refunded",
  "cancelled",
]);
export const spendRequestStatus = pgEnum("spend_request_status", [
  "proposed",
  "blocked",
  "pending_approval",
  "approved",
  "rejected",
  "executing",
  "executed",
  "failed",
]);

export const events = pgTable("events", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  startsOn: date("starts_on"),
  endsOn: date("ends_on"),
  currency: text("currency").notNull().default("USD"),
  status: text("status").notNull().default("active"),
  /** Per-person registration fee. */
  feeCents: cents("fee_cents").notNull().default(0),
  createdAt: createdAt(),
});

export const budgetLines = pgTable("budget_lines", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull().references(() => events.id),
  name: text("name").notNull(),
  category: text("category").notNull(),
  allocatedCents: cents("allocated_cents").notNull(),
  /** Denormalised for fast display; source of truth is the sum of outgoing ledger entries. */
  spentCents: cents("spent_cents").notNull().default(0),
});

export const policies = pgTable("policies", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull().references(() => events.id),
  /** Parsed YAML policy (see policies/*.yaml). */
  document: jsonb("document").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: createdAt(),
});

/** A team (or a solo participant: a team of one). */
export const registrations = pgTable(
  "registrations",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull().references(() => events.id),
    teamName: text("team_name").notNull(),
    /** Optional workshop / track, used for bulk refunds ("refund everyone in Workshop B"). */
    track: text("track"),
    feeCents: cents("fee_cents").notNull(),
    paidCents: cents("paid_cents").notNull().default(0),
    status: registrationStatus("status").notNull().default("pending"),
    createdAt: createdAt(),
  },
  (t) => [index("registrations_event_idx").on(t.eventId)],
);

export const members = pgTable(
  "members",
  {
    id: text("id").primaryKey(),
    registrationId: text("registration_id").notNull().references(() => registrations.id),
    name: text("name").notNull(),
    email: text("email").notNull(),
    isLead: boolean("is_lead").notNull().default(false),
    /** Share of the team fee this member owes when paying individually. */
    shareCents: cents("share_cents").notNull(),
    paidCents: cents("paid_cents").notNull().default(0),
    /** Unguessable token for the member's personal payment link (/e/:slug/pay/:token). */
    payToken: text("pay_token").notNull().unique(),
    nudgesSent: integer("nudges_sent").notNull().default(0),
    lastNudgedAt: timestamp("last_nudged_at", { withTimezone: true }),
  },
  (t) => [index("members_registration_idx").on(t.registrationId)],
);

export const volunteers = pgTable("volunteers", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull().references(() => events.id),
  name: text("name").notNull(),
  email: text("email").notNull(),
});

export const vendors = pgTable("vendors", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull().references(() => events.id),
  name: text("name").notNull(),
  email: text("email").notNull(),
  allowlisted: boolean("allowlisted").notNull().default(false),
});

export const sponsors = pgTable("sponsors", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull().references(() => events.id),
  name: text("name").notNull(),
  tier: text("tier"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email").notNull(),
  amountCents: cents("amount_cents").notNull(),
  deliverables: jsonb("deliverables").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
});

export const invoices = pgTable("invoices", {
  id: text("id").primaryKey(),
  sponsorId: text("sponsor_id").notNull().references(() => sponsors.id),
  paypalInvoiceId: text("paypal_invoice_id").unique(),
  invoiceNumber: text("invoice_number"),
  amountCents: cents("amount_cents").notNull(),
  dueDate: date("due_date"),
  status: text("status").notNull().default("draft"),
  remindersSent: integer("reminders_sent").notNull().default(0),
  lastRemindedAt: timestamp("last_reminded_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** Receipts uploaded by volunteers (C3). Extraction fields are filled by AI 2's extractor. */
export const receipts = pgTable("receipts", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull().references(() => events.id),
  volunteerId: text("volunteer_id").references(() => volunteers.id),
  submitterName: text("submitter_name").notNull(),
  submitterEmail: text("submitter_email").notNull(),
  note: text("note"),
  /** Path/key in file storage. Originals are kept for the audit trail. */
  fileKey: text("file_key").notNull(),
  mimeType: text("mime_type").notNull(),
  /** sha256 of the file bytes, for duplicate detection. */
  sha256: text("sha256").notNull(),
  extraction: jsonb("extraction"),
  status: text("status").notNull().default("uploaded"),
  createdAt: createdAt(),
});

export const spendRequests = pgTable("spend_requests", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull().references(() => events.id),
  kind: spendKind("kind").notNull(),
  budgetLineId: text("budget_line_id").notNull().references(() => budgetLines.id),
  title: text("title").notNull(),
  amountCents: cents("amount_cents").notNull(),
  /** Full SpendProposal (see @treasurer/shared). */
  proposal: jsonb("proposal").notNull(),
  /** PolicyDecision from the policy engine. */
  policyResult: jsonb("policy_result"),
  /** Approval card text from the explainer (AI 5). */
  explanation: jsonb("explanation"),
  status: spendRequestStatus("status").notNull().default("proposed"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  createdAt: createdAt(),
});

export const approvals = pgTable("approvals", {
  id: text("id").primaryKey(),
  spendRequestId: text("spend_request_id").notNull().references(() => spendRequests.id),
  approverRole: text("approver_role").notNull(),
  approverName: text("approver_name"),
  decision: text("decision").notNull(), // approved | rejected
  comment: text("comment"),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payouts = pgTable("payouts", {
  id: text("id").primaryKey(),
  spendRequestId: text("spend_request_id").references(() => spendRequests.id),
  senderBatchId: text("sender_batch_id").notNull().unique(),
  paypalBatchId: text("paypal_batch_id").unique(),
  status: text("status").notNull().default("pending"),
  /** [{ senderItemId, payoutItemId, receiver, amountCents, status }] */
  items: jsonb("items").notNull().default(sql`'[]'::jsonb`),
  createdAt: createdAt(),
});

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull().references(() => events.id),
    direction: ledgerDirection("direction").notNull(),
    amountCents: cents("amount_cents").notNull(),
    budgetLineId: text("budget_line_id").references(() => budgetLines.id),
    paypalObjectType: text("paypal_object_type"),
    paypalObjectId: text("paypal_object_id"),
    /** e.g. "registration", "member", "invoice", "spend_request", "payout" */
    businessObjectType: text("business_object_type"),
    businessObjectId: text("business_object_id"),
    description: text("description"),
    reconStatus: reconStatus("recon_status").notNull().default("unmatched"),
    reconNote: text("recon_note"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ledger_event_idx").on(t.eventId),
    uniqueIndex("ledger_paypal_object_uq").on(t.paypalObjectType, t.paypalObjectId),
  ],
);

/** Append-only. Never update or delete rows. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id"),
    actor: text("actor").notNull(), // "agent", "policy", "user:<role>", "webhook", "worker"
    action: text("action").notNull(), // e.g. "proposal.created", "rule.blocked", "paypal.payout.create"
    subjectType: text("subject_type"),
    subjectId: text("subject_id"),
    data: jsonb("data"),
    paypalRequestId: text("paypal_request_id"),
    paypalDebugId: text("paypal_debug_id"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_subject_idx").on(t.subjectType, t.subjectId)],
);

export const webhookEvents = pgTable("webhook_events", {
  /** PayPal webhook event id — the idempotency key. */
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  verified: boolean("verified").notNull(),
  payload: jsonb("payload").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  error: text("error"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Outbound messages drafted by the nudge/reminder writer (AI 5). */
export const messages = pgTable("messages", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull().references(() => events.id),
  kind: text("kind").notNull(), // member_nudge | sponsor_reminder
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  toEmail: text("to_email").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("draft"), // draft | sent | skipped
  createdAt: createdAt(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});

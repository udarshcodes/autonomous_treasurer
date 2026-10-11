import { z } from "zod";

/** Enumerations shared by the database schema, API, agent, policy engine and UI. */

export const SpendKind = z.enum(["reimbursement", "vendor", "prize", "refund"]);
export type SpendKind = z.infer<typeof SpendKind>;

export const ApproverRole = z.enum(["treasurer", "faculty_advisor", "organizer"]);
export type ApproverRole = z.infer<typeof ApproverRole>;

export const LedgerDirection = z.enum(["in", "out"]);
export type LedgerDirection = z.infer<typeof LedgerDirection>;

export const ReconStatus = z.enum(["unmatched", "matched", "flagged", "suggested"]);
export type ReconStatus = z.infer<typeof ReconStatus>;

export const PayPalObjectType = z.enum(["order", "capture", "refund", "invoice", "payout_batch", "payout_item"]);
export type PayPalObjectType = z.infer<typeof PayPalObjectType>;

export const RegistrationStatus = z.enum(["pending", "partially_paid", "paid", "refunded", "cancelled"]);
export type RegistrationStatus = z.infer<typeof RegistrationStatus>;

export const SpendRequestStatus = z.enum([
  "proposed",
  "blocked", // a hard rule failed; never reaches a human
  "pending_approval",
  "approved",
  "rejected",
  "executing",
  "executed",
  "failed",
]);
export type SpendRequestStatus = z.infer<typeof SpendRequestStatus>;

/** Who a payout may go to. Mirrors `recipients.allow` in the policy file. */
export const RecipientKind = z.enum(["registered_volunteer", "allowlisted_vendor", "confirmed_winner", "registrant"]);
export type RecipientKind = z.infer<typeof RecipientKind>;

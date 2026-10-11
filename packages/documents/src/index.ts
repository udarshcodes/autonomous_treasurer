/**
 * Document intelligence — owner: AI 2.
 *  - Receipt vision extractor (total re-summed in code from line items)   C3
 *  - Sponsor email / MoU extractor                                         C2
 *  - Budget-line classifier (label set = the event's real budget lines)
 *  - Receipt-hash duplicate detection
 *  - Receipt eval set: evals/receipts (20-30 labelled images)
 */
import { createHash } from "node:crypto";
import { z } from "zod";

export const ReceiptExtraction = z.object({
  vendor: z.string().nullable(),
  date: z.string().nullable(),
  lineItems: z.array(z.object({ description: z.string(), amountCents: z.int() })),
  totalCents: z.int().nullable(),
  currency: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});
export type ReceiptExtraction = z.infer<typeof ReceiptExtraction>;

export const SponsorExtraction = z.object({
  sponsor: z.string(),
  contactEmail: z.string().nullable(),
  tier: z.string().nullable(),
  amountCents: z.int().nullable(),
  currency: z.string().nullable(),
  dueDate: z.string().nullable(),
  deliverables: z.array(z.string()),
  lowConfidenceFields: z.array(z.string()),
});
export type SponsorExtraction = z.infer<typeof SponsorExtraction>;

export function receiptHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// TODO(AI 2): extractReceipt(image), extractSponsorEmail(text), classifyBudgetLine(receipt, lines).

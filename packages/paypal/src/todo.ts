import type { PayPalClient } from "./client";

/**
 * Wrappers still to build — owner: Dev 1. Signatures are the agreed contract;
 * other modules may import these now and get a clear error until implemented.
 */

const notYet = (name: string): never => {
  throw new Error(`@treasurer/paypal: ${name} is not implemented yet (owner: Dev 1)`);
};

/** Payments v2 — S1 bulk refunds. Use a deterministic requestId per refund. */
export async function refundCapture(
  _pp: PayPalClient,
  _input: { captureId: string; amountCents: number; requestId: string; note?: string },
): Promise<{ id: string; status: string }> {
  return notYet("refundCapture");
}

/** Invoicing v2 — C2 sponsor invoicing. */
export async function createDraftInvoice(_pp: PayPalClient, _input: unknown): Promise<{ id: string }> {
  return notYet("createDraftInvoice");
}
export async function sendInvoice(_pp: PayPalClient, _invoiceId: string, _requestId: string): Promise<void> {
  return notYet("sendInvoice");
}
/** The agent decides when; PayPal sends it. Body text comes from the reminder writer (AI 5). */
export async function remindInvoice(
  _pp: PayPalClient,
  _invoiceId: string,
  _input: { subject: string; note: string; requestId: string },
): Promise<void> {
  return notYet("remindInvoice");
}

/** Transaction Search v1 — nightly cross-check only (up to 3h lag, max 31-day range). */
export async function searchTransactions(
  _pp: PayPalClient,
  _input: { startDate: string; endDate: string; page?: number },
): Promise<unknown> {
  return notYet("searchTransactions");
}

/** Webhooks — verify-webhook-signature. */
export async function verifyWebhookSignature(
  _pp: PayPalClient,
  _input: { headers: Record<string, string | undefined>; body: unknown; webhookId: string },
): Promise<boolean> {
  return notYet("verifyWebhookSignature");
}

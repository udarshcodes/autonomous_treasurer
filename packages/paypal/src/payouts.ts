import type { PayPalClient } from "./client";

/**
 * Payouts v1 — C3 reimbursements, C5 prize payouts.
 * ONLY the policy engine may call createBatchPayout.
 *
 * - sender_batch_id is idempotent for 30 days.
 * - Sandbox: EMAIL recipients only (PHONE unsupported).
 * - The sender account needs balance or items fail with INSUFFICIENT_FUNDS.
 */

export type PayoutPurpose = "PRIZES" | "NON_GOODS_OR_SERVICES" | "GOODS" | "SERVICES";

export interface PayoutItem {
  recipient_type: "EMAIL";
  receiver: string;
  amount: { value: string; currency: string };
  sender_item_id: string;
  note?: string;
  purpose?: PayoutPurpose;
}

export interface PayoutBatchRequest {
  sender_batch_header: {
    sender_batch_id: string;
    email_subject: string;
    email_message?: string;
  };
  items: PayoutItem[];
}

export interface PayoutBatchResponse {
  batch_header: { payout_batch_id: string; batch_status: string; sender_batch_header: { sender_batch_id: string } };
  items?: Array<{ payout_item_id: string; transaction_status: string; payout_item: PayoutItem }>;
}

export async function createBatchPayout(pp: PayPalClient, batch: PayoutBatchRequest) {
  const { data, debugId } = await pp.request<PayoutBatchResponse>("/v1/payments/payouts", {
    method: "POST",
    requestId: batch.sender_batch_header.sender_batch_id,
    body: batch,
  });
  return { data, debugId };
}

export async function getBatchPayout(pp: PayPalClient, payoutBatchId: string) {
  const { data } = await pp.request<PayoutBatchResponse>(`/v1/payments/payouts/${encodeURIComponent(payoutBatchId)}`);
  return data;
}

// TODO(Dev 1): getPayoutItem, cancelUnclaimedItem

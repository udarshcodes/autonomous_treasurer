import { centsToPayPalValue, type Cents } from "@treasurer/shared";
import type { PayPalClient } from "./client";

/** Orders v2 — C1 registrations and team payments. */

export interface CreateOrderInput {
  amountCents: Cents;
  currency?: string;
  /** Our registration/member id. Every capture maps back via custom_id, no guessing. */
  customId: string;
  description: string;
  requestId: string;
}

export interface PayPalOrder {
  id: string;
  status: string;
  purchase_units?: Array<{
    custom_id?: string;
    payments?: { captures?: Array<{ id: string; status: string; amount: { value: string; currency_code: string } }> };
  }>;
}

export async function createOrder(pp: PayPalClient, input: CreateOrderInput) {
  const { data } = await pp.request<PayPalOrder>("/v2/checkout/orders", {
    method: "POST",
    requestId: input.requestId,
    body: {
      intent: "CAPTURE",
      purchase_units: [
        {
          custom_id: input.customId,
          description: input.description.slice(0, 127),
          amount: { currency_code: input.currency ?? "USD", value: centsToPayPalValue(input.amountCents) },
        },
      ],
    },
  });
  return data;
}

export async function captureOrder(pp: PayPalClient, orderId: string, requestId: string) {
  const { data } = await pp.request<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: "POST",
    requestId,
    body: {},
  });
  return data;
}

export async function getOrder(pp: PayPalClient, orderId: string) {
  const { data } = await pp.request<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}`);
  return data;
}

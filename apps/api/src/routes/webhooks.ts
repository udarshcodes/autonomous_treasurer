/**
 * PayPal webhook receiver — owner: Dev 1.
 * Store raw, verify signature, process idempotently by event id.
 */
import { Hono } from "hono";
import { schema } from "@treasurer/db";
import { getDeps } from "../context";

export const webhookRoutes = new Hono();

webhookRoutes.post("/paypal", async (c) => {
  const { db } = await getDeps();
  const payload = (await c.req.json().catch(() => null)) as { id?: string; event_type?: string } | null;
  if (!payload?.id || !payload.event_type) return c.json({ error: "Invalid webhook" }, 400);

  // TODO(Dev 1): verifyWebhookSignature(...) before trusting the payload.
  const verified = false;
  const inserted = await db
    .insert(schema.webhookEvents)
    .values({ id: payload.id, eventType: payload.event_type, verified, payload })
    .onConflictDoNothing()
    .returning({ id: schema.webhookEvents.id });

  // TODO(Dev 1): dispatch by event_type, e.g. PAYMENT.CAPTURE.COMPLETED -> recordCapture(custom_id, ...)
  //              (see routes/public.ts), PAYMENT.PAYOUTS-ITEM.*, INVOICING.INVOICE.PAID, PAYMENT.CAPTURE.REFUNDED.
  return c.json({ received: true, duplicate: inserted.length === 0 });
});

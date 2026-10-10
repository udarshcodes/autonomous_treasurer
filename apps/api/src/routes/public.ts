/**
 * Public endpoints behind the public pages — owner: AI 5.
 * No login: participants and volunteers arrive from a link. Every write is scoped
 * by an unguessable token or the event slug, and nothing here can move money out.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import { and, eq, schema, sql } from "@treasurer/db";
import { captureOrder, createOrder, PayPalError } from "@treasurer/paypal";
import { newId, payPalValueToCents, splitCents, stableKey } from "@treasurer/shared";
import { getDeps } from "../context";
import { audit } from "../lib/audit";

export const publicRoutes = new Hono();

const payToken = () => randomBytes(18).toString("base64url");

async function eventBySlug(slug: string) {
  const { db } = await getDeps();
  const [event] = await db.select().from(schema.events).where(eq(schema.events.slug, slug));
  return event;
}

publicRoutes.get("/events/:slug", async (c) => {
  const event = await eventBySlug(c.req.param("slug"));
  if (!event) return c.json({ error: "Event not found" }, 404);
  return c.json({
    slug: event.slug,
    name: event.name,
    startsOn: event.startsOn,
    endsOn: event.endsOn,
    currency: event.currency,
    feeCents: event.feeCents,
  });
});

const RegistrationBody = z.object({
  teamName: z.string().trim().min(1).max(80),
  track: z.string().trim().max(80).optional(),
  members: z
    .array(z.object({ name: z.string().trim().min(1).max(120), email: z.email().max(200) }))
    .min(1)
    .max(6),
  /** "team": the lead pays for everyone now. "split": everyone gets their own pay link. */
  payMode: z.enum(["team", "split"]),
});

publicRoutes.post("/events/:slug/registrations", async (c) => {
  const event = await eventBySlug(c.req.param("slug"));
  if (!event) return c.json({ error: "Event not found" }, 404);
  const parsed = RegistrationBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid registration", details: parsed.error.issues }, 400);
  const body = parsed.data;

  const emails = body.members.map((m) => m.email.toLowerCase());
  if (new Set(emails).size !== emails.length) return c.json({ error: "Each member needs a different email" }, 400);

  const { db, publicAppUrl } = await getDeps();
  const feeCents = event.feeCents * body.members.length;
  const shares = splitCents(feeCents, body.members.length);
  const registrationId = newId("reg");

  const members = body.members.map((m, i) => ({
    id: newId("mem"),
    registrationId,
    name: m.name,
    email: m.email.toLowerCase(),
    isLead: i === 0,
    shareCents: shares[i]!,
    payToken: payToken(),
  }));

  await db.transaction(async (tx) => {
    await tx.insert(schema.registrations).values({
      id: registrationId,
      eventId: event.id,
      teamName: body.teamName,
      track: body.track,
      feeCents,
    });
    await tx.insert(schema.members).values(members);
  });
  await audit(db, { eventId: event.id, actor: "public", action: "registration.created", subjectType: "registration", subjectId: registrationId });

  return c.json(
    {
      registrationId,
      teamName: body.teamName,
      feeCents,
      payMode: body.payMode,
      members: members.map((m) => ({
        name: m.name,
        email: m.email,
        isLead: m.isLead,
        shareCents: m.shareCents,
        payLink: `${publicAppUrl}/e/${event.slug}/pay/${m.payToken}`,
      })),
      leadPayToken: members[0]!.payToken,
    },
    201,
  );
});

async function memberByToken(token: string) {
  const { db } = await getDeps();
  const [row] = await db
    .select({ member: schema.members, registration: schema.registrations, event: schema.events })
    .from(schema.members)
    .innerJoin(schema.registrations, eq(schema.members.registrationId, schema.registrations.id))
    .innerJoin(schema.events, eq(schema.registrations.eventId, schema.events.id))
    .where(eq(schema.members.payToken, token));
  return row;
}

publicRoutes.get("/pay/:token", async (c) => {
  const row = await memberByToken(c.req.param("token"));
  if (!row) return c.json({ error: "Payment link not found" }, 404);
  const { db } = await getDeps();
  const team = await db.select().from(schema.members).where(eq(schema.members.registrationId, row.registration.id));
  const teamOutstanding = team.reduce((s, m) => s + Math.max(0, m.shareCents - m.paidCents), 0);
  return c.json({
    event: { slug: row.event.slug, name: row.event.name },
    teamName: row.registration.teamName,
    status: row.registration.status,
    member: { name: row.member.name, isLead: row.member.isLead },
    memberDueCents: Math.max(0, row.member.shareCents - row.member.paidCents),
    teamOutstandingCents: teamOutstanding,
    team: team.map((m) => ({ name: m.name, paid: m.paidCents >= m.shareCents, isLead: m.isLead })),
  });
});

const OrderBody = z.object({ token: z.string().min(10), scope: z.enum(["member", "team"]) });

/**
 * custom_id format: "mem:<memberId>" or "reg:<registrationId>".
 * Every capture (and every webhook) maps back to the business object without guessing.
 */
publicRoutes.post("/orders", async (c) => {
  const { paypal, db } = await getDeps();
  if (!paypal) return c.json({ error: "Payments are not configured" }, 503);
  const parsed = OrderBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid request" }, 400);

  const row = await memberByToken(parsed.data.token);
  if (!row) return c.json({ error: "Payment link not found" }, 404);
  if (parsed.data.scope === "team" && !row.member.isLead) return c.json({ error: "Only the team lead can pay for the team" }, 403);

  let amountCents: number;
  let customId: string;
  if (parsed.data.scope === "team") {
    const team = await db.select().from(schema.members).where(eq(schema.members.registrationId, row.registration.id));
    amountCents = team.reduce((s, m) => s + Math.max(0, m.shareCents - m.paidCents), 0);
    customId = `reg:${row.registration.id}`;
  } else {
    amountCents = Math.max(0, row.member.shareCents - row.member.paidCents);
    customId = `mem:${row.member.id}`;
  }
  if (amountCents === 0) return c.json({ error: "Nothing left to pay" }, 409);

  try {
    const order = await createOrder(paypal, {
      amountCents,
      customId,
      description: `${row.event.name} registration, team ${row.registration.teamName}`,
      // Same payer + amount within a 10-minute window reuses the order (double clicks, retries).
      requestId: `order-${stableKey(customId, amountCents, Math.floor(Date.now() / 600_000))}`,
    });
    await audit(db, {
      eventId: row.event.id,
      actor: "public",
      action: "paypal.order.create",
      subjectType: "registration",
      subjectId: row.registration.id,
      data: { orderId: order.id, customId, amountCents },
    });
    return c.json({ orderId: order.id });
  } catch (err) {
    if (err instanceof PayPalError) return c.json({ error: "PayPal could not create the order", debugId: err.debugId }, 502);
    throw err;
  }
});

/**
 * Capture on return from checkout. The webhook (Dev 1) records the same capture;
 * both paths are idempotent on the ledger's unique (paypal_object_type, paypal_object_id).
 */
publicRoutes.post("/orders/:orderId/capture", async (c) => {
  const { paypal, db } = await getDeps();
  if (!paypal) return c.json({ error: "Payments are not configured" }, 503);
  const orderId = c.req.param("orderId");

  let order;
  try {
    order = await captureOrder(paypal, orderId, `capture-${orderId}`);
  } catch (err) {
    if (err instanceof PayPalError) return c.json({ error: "PayPal could not capture the payment", debugId: err.debugId }, 502);
    throw err;
  }
  const unit = order.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  if (!unit?.custom_id || !capture || capture.status !== "COMPLETED") {
    return c.json({ status: order.status, captureStatus: capture?.status ?? null }, 202);
  }
  await recordCapture(unit.custom_id, capture.id, payPalValueToCents(capture.amount.value));
  return c.json({ status: "COMPLETED", captureId: capture.id });
});

/** Apply a completed capture to members/registration and the ledger. Safe to call twice. */
export async function recordCapture(customId: string, captureId: string, amountCents: number) {
  const { db } = await getDeps();
  const [kind, id] = customId.split(":");
  if (!id || (kind !== "mem" && kind !== "reg")) throw new Error(`Unknown custom_id ${customId}`);

  await db.transaction(async (tx) => {
    const memberRows =
      kind === "mem"
        ? await tx.select().from(schema.members).where(eq(schema.members.id, id))
        : await tx.select().from(schema.members).where(eq(schema.members.registrationId, id));
    const registrationId = kind === "reg" ? id : memberRows[0]?.registrationId;
    if (!registrationId) throw new Error(`No registration for ${customId}`);
    const [reg] = await tx.select().from(schema.registrations).where(eq(schema.registrations.id, registrationId));
    if (!reg) throw new Error(`No registration ${registrationId}`);

    const inserted = await tx
      .insert(schema.ledgerEntries)
      .values({
        id: newId("led"),
        eventId: reg.eventId,
        direction: "in",
        amountCents,
        paypalObjectType: "capture",
        paypalObjectId: captureId,
        businessObjectType: kind === "mem" ? "member" : "registration",
        businessObjectId: id,
        description: `Registration fee, team ${reg.teamName}`,
        reconStatus: "matched",
      })
      .onConflictDoNothing()
      .returning({ id: schema.ledgerEntries.id });
    if (inserted.length === 0) return; // already recorded by the webhook or a retry

    // Allocate the captured amount to unpaid members in order (lead first).
    let left = amountCents;
    for (const m of memberRows.sort((a, b) => Number(b.isLead) - Number(a.isLead))) {
      const take = Math.min(left, Math.max(0, m.shareCents - m.paidCents));
      if (take > 0) {
        await tx.update(schema.members).set({ paidCents: m.paidCents + take }).where(eq(schema.members.id, m.id));
        left -= take;
      }
    }
    const paidCents = reg.paidCents + amountCents;
    await tx
      .update(schema.registrations)
      .set({ paidCents, status: paidCents >= reg.feeCents ? "paid" : "partially_paid" })
      .where(eq(schema.registrations.id, reg.id));
  });
}

/* ------------------------------------------------------------------ */
/* Volunteer receipt upload (C3 entry point)                           */
/* ------------------------------------------------------------------ */

const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
const RECEIPT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"]);

publicRoutes.post("/events/:slug/receipts", async (c) => {
  const event = await eventBySlug(c.req.param("slug"));
  if (!event) return c.json({ error: "Event not found" }, 404);
  const form = await c.req.formData().catch(() => null);
  if (!form) return c.json({ error: "Expected multipart form data" }, 400);

  const fields = z
    .object({
      name: z.string().trim().min(1).max(120),
      email: z.email().max(200),
      note: z.string().trim().max(500).optional(),
    })
    .safeParse({ name: form.get("name"), email: form.get("email"), note: form.get("note") || undefined });
  if (!fields.success) return c.json({ error: "Name and a valid email are required" }, 400);

  const file = form.get("receipt");
  if (!(file instanceof File)) return c.json({ error: "Attach a receipt photo" }, 400);
  if (!RECEIPT_TYPES.has(file.type)) return c.json({ error: "Upload a JPG, PNG, WebP, HEIC or PDF" }, 415);
  if (file.size > MAX_RECEIPT_BYTES) return c.json({ error: "Receipt must be under 10 MB" }, 413);

  const { db, uploadDir } = await getDeps();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const [duplicate] = await db
    .select({ id: schema.receipts.id })
    .from(schema.receipts)
    .where(and(eq(schema.receipts.eventId, event.id), eq(schema.receipts.sha256, sha256)));
  if (duplicate) return c.json({ error: "This receipt was already submitted", receiptId: duplicate.id }, 409);

  const [volunteer] = await db
    .select()
    .from(schema.volunteers)
    .where(and(eq(schema.volunteers.eventId, event.id), sql`lower(${schema.volunteers.email}) = ${fields.data.email.toLowerCase()}`));

  const id = newId("rcpt");
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "application/pdf": "pdf" }[file.type];
  const fileKey = path.join(event.slug, `${id}.${ext}`);
  await mkdir(path.join(uploadDir, event.slug), { recursive: true });
  await writeFile(path.join(uploadDir, fileKey), bytes);

  await db.insert(schema.receipts).values({
    id,
    eventId: event.id,
    volunteerId: volunteer?.id,
    submitterName: fields.data.name,
    submitterEmail: fields.data.email.toLowerCase(),
    note: fields.data.note,
    fileKey,
    mimeType: file.type,
    sha256,
  });
  await audit(db, { eventId: event.id, actor: "public", action: "receipt.uploaded", subjectType: "receipt", subjectId: id });
  // TODO(AI 2): enqueue extraction -> budget-line classification -> propose_reimbursement.

  return c.json(
    {
      receiptId: id,
      registeredVolunteer: Boolean(volunteer),
      message: volunteer
        ? "Receipt received. The treasurer will review it and you will be paid to this email via PayPal."
        : "Receipt received. This email is not on the volunteer list yet, so the treasurer will confirm it first.",
    },
    201,
  );
});

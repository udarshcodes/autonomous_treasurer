/**
 * Staff endpoints for comms, nudges and prize payouts — owner: AI 5.
 * The agent (AI 1) wraps the same functions as tools; these routes serve the UI and Postman.
 */
import { Hono } from "hono";
import { z } from "zod";
import {
  buildPrizeBatchPreview,
  draftMemberNudge,
  explainApproval,
  findNudgeTargets,
  parsePrizeList,
  prizePreviewToProposal,
} from "@treasurer/comms";
import { and, eq, schema } from "@treasurer/db";
import { newId, PolicyDecision, proposalTotalCents, SpendProposal } from "@treasurer/shared";
import { getDeps } from "../context";
import { audit } from "../lib/audit";
import { loadTeams } from "../lib/teams";

export const commsRoutes = new Hono();

async function loadEvent(eventId: string) {
  const { db } = await getDeps();
  const [event] = await db.select().from(schema.events).where(eq(schema.events.id, eventId));
  return event;
}

/* ---------------------------- C1 nudges ---------------------------- */

/** Scan for unpaid members and draft nudges. Drafts are stored; sending is a separate step. */
commsRoutes.post("/events/:eventId/nudges/scan", async (c) => {
  const event = await loadEvent(c.req.param("eventId"));
  if (!event) return c.json({ error: "Event not found" }, 404);
  const body = z.object({ deadline: z.string().max(60).optional(), dryRun: z.boolean().default(false) }).parse(await c.req.json().catch(() => ({})));
  const { db, llm, publicAppUrl } = await getDeps();

  const scan = findNudgeTargets(await loadTeams(db, event.id), new Date());
  const drafts = [];
  for (const target of scan.targets) {
    const msg = await draftMemberNudge(
      { target, eventName: event.name, payLink: `${publicAppUrl}/e/${event.slug}/pay/${target.member.payToken}`, deadline: body.deadline },
      llm,
    );
    const id = newId("msg");
    if (!body.dryRun) {
      await db.insert(schema.messages).values({
        id,
        eventId: event.id,
        kind: "member_nudge",
        subjectType: "member",
        subjectId: target.member.id,
        toEmail: msg.to,
        subject: msg.subject,
        body: msg.body,
      });
    }
    drafts.push({ id, memberId: target.member.id, team: target.team.teamName, reason: target.reason, ...msg });
  }
  if (!body.dryRun) {
    await audit(db, { eventId: event.id, actor: "agent", action: "nudges.drafted", data: { count: drafts.length, skipped: scan.skipped } });
  }

  return c.json({
    partialTeams: scan.partialTeams.map(({ unpaidMembers, lead, ...t }) => ({ ...t, unpaid: unpaidMembers.map((m) => m.name) })),
    unpaidTeams: scan.unpaidTeams.length,
    skipped: scan.skipped,
    drafts,
  });
});

/**
 * Mark a drafted nudge as sent. Delivery (email / Zapier) is TODO(Dev 1);
 * this records the send so cooldowns and tone escalation work.
 */
commsRoutes.post("/messages/:id/send", async (c) => {
  const { db } = await getDeps();
  const [msg] = await db.select().from(schema.messages).where(eq(schema.messages.id, c.req.param("id")));
  if (!msg) return c.json({ error: "Message not found" }, 404);
  if (msg.status !== "draft") return c.json({ error: `Message is already ${msg.status}` }, 409);
  const now = new Date();
  await db.update(schema.messages).set({ status: "sent", sentAt: now }).where(eq(schema.messages.id, msg.id));
  if (msg.kind === "member_nudge") {
    const [m] = await db.select().from(schema.members).where(eq(schema.members.id, msg.subjectId));
    if (m) await db.update(schema.members).set({ nudgesSent: m.nudgesSent + 1, lastNudgedAt: now }).where(eq(schema.members.id, m.id));
  }
  await audit(db, { eventId: msg.eventId, actor: "user:treasurer", action: "message.sent", subjectType: "message", subjectId: msg.id });
  return c.json({ status: "sent" });
});

/* -------------------------- C5 prize payouts ------------------------- */

const PrizeBody = z.object({
  text: z.string().min(1).max(50_000),
  budgetLineId: z.string(),
  splitMode: z.enum(["lead", "equal"]).default("lead"),
  prizeTable: z.array(z.object({ place: z.int().positive(), amountCents: z.int().positive() })).optional(),
});

async function previewFor(eventId: string, body: z.infer<typeof PrizeBody>) {
  const { db, llm } = await getDeps();
  const event = await loadEvent(eventId);
  if (!event) return { error: "Event not found" as const };
  const [line] = await db
    .select()
    .from(schema.budgetLines)
    .where(and(eq(schema.budgetLines.id, body.budgetLineId), eq(schema.budgetLines.eventId, event.id)));
  if (!line) return { error: "Budget line not found" as const };
  const list = await parsePrizeList(body.text, llm);
  const preview = buildPrizeBatchPreview({
    event: { id: event.id, name: event.name },
    list,
    teams: await loadTeams(db, event.id),
    budgetLine: line,
    prizeTable: body.prizeTable,
    splitMode: body.splitMode,
  });
  return { event, line, list, preview };
}

commsRoutes.post("/events/:eventId/prizes/preview", async (c) => {
  const body = PrizeBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Invalid request", details: body.error.issues }, 400);
  const result = await previewFor(c.req.param("eventId"), body.data);
  if ("error" in result) return c.json({ error: result.error }, 404);
  return c.json({ source: result.list.source, preview: result.preview });
});

/**
 * Turn a clean preview into a SpendRequest. The policy engine (AI 3) evaluates it next;
 * nothing is sent to PayPal from here.
 */
commsRoutes.post("/events/:eventId/prizes/propose", async (c) => {
  const body = PrizeBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Invalid request", details: body.error.issues }, 400);
  const result = await previewFor(c.req.param("eventId"), body.data);
  if ("error" in result) return c.json({ error: result.error }, 404);
  if (!result.preview.ok) return c.json({ error: "Fix the issues in the preview first", preview: result.preview }, 422);

  const { db } = await getDeps();
  const uploadId = newId("upl");
  await audit(db, { eventId: result.event.id, actor: "user:treasurer", action: "prize_list.uploaded", subjectType: "upload", subjectId: uploadId, data: { text: body.data.text } });
  const proposal = prizePreviewToProposal(result.preview, { eventId: result.event.id, budgetLineId: result.line.id, uploadId });

  const id = newId("spr");
  const inserted = await db
    .insert(schema.spendRequests)
    .values({
      id,
      eventId: proposal.eventId,
      kind: proposal.kind,
      budgetLineId: proposal.budgetLineId,
      title: proposal.title,
      amountCents: proposalTotalCents(proposal),
      proposal,
      idempotencyKey: proposal.idempotencyKey,
    })
    .onConflictDoNothing()
    .returning({ id: schema.spendRequests.id });
  if (inserted.length === 0) {
    const [existing] = await db.select().from(schema.spendRequests).where(eq(schema.spendRequests.idempotencyKey, proposal.idempotencyKey));
    return c.json({ spendRequestId: existing?.id, status: existing?.status, duplicate: true }, 200);
  }
  await audit(db, { eventId: proposal.eventId, actor: "agent", action: "proposal.created", subjectType: "spend_request", subjectId: id, data: proposal });
  // TODO(AI 3): policy.evaluate(proposal) -> status blocked | pending_approval, then explain (below).
  return c.json({ spendRequestId: id, status: "proposed", proposal }, 201);
});

/* ------------------------ C4 approval explainer ----------------------- */

/** (Re)build the approval card for a spend request once the policy engine has decided. */
commsRoutes.post("/spend-requests/:id/explain", async (c) => {
  const { db, llm } = await getDeps();
  const [req] = await db.select().from(schema.spendRequests).where(eq(schema.spendRequests.id, c.req.param("id")));
  if (!req) return c.json({ error: "Spend request not found" }, 404);
  const decision = PolicyDecision.safeParse(req.policyResult);
  if (!decision.success) return c.json({ error: "Policy engine has not evaluated this request yet" }, 409);
  const [line] = await db.select().from(schema.budgetLines).where(eq(schema.budgetLines.id, req.budgetLineId));
  if (!line) return c.json({ error: "Budget line missing" }, 500);

  const proposal = SpendProposal.parse(req.proposal);
  const recipients = new Set(proposal.items.map((i) => i.recipientEmail));
  const card = await explainApproval(
    {
      kind: req.kind,
      title: req.title,
      recipientSummary: recipients.size === 1 ? [...recipients][0]! : `${recipients.size} recipients`,
      amountCents: req.amountCents,
      itemCount: proposal.items.length,
      budgetLine: line,
      decision: decision.data,
    },
    llm,
  );
  await db.update(schema.spendRequests).set({ explanation: card }).where(eq(schema.spendRequests.id, req.id));
  if (card.rejectedDrafts.length > 0) {
    await audit(db, { eventId: req.eventId, actor: "agent", action: "explainer.draft_rejected", subjectType: "spend_request", subjectId: req.id, data: card.rejectedDrafts });
  }
  return c.json(card);
});

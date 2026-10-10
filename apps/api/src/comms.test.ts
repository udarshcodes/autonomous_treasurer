import path from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { beforeAll, describe, expect, it } from "vitest";

process.env.PGLITE_DIR = "memory://";
process.env.DEMO_MODE = "true";
process.env.PUBLIC_APP_URL = "http://app.test";
process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "treasurer-uploads-"));
delete process.env.ANTHROPIC_API_KEY;
delete process.env.PAYPAL_CLIENT_ID;

const { getDb, schema, eq } = await import("@treasurer/db");
const { migrate } = await import("drizzle-orm/pglite/migrator");
const { app } = await import("./app");

const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  const db = await getDb();
  await migrate(db as never, { migrationsFolder: path.resolve(import.meta.dirname, "../../../packages/db/migrations") });
  await db.insert(schema.events).values({ id: "evt_1", slug: "hackfest", name: "HackFest 2026", feeCents: 2500 });
  await db.insert(schema.budgetLines).values({ id: "bl_prizes", eventId: "evt_1", name: "Prizes", category: "prizes", allocatedCents: 200000 });
  await db.insert(schema.volunteers).values({ id: "vol_1", eventId: "evt_1", name: "Priya Shah", email: "priya@example.edu" });
});

describe("public pages API + comms", () => {
  let payLinks: string[] = [];

  it("registers a team with a personal pay link per member", async () => {
    const res = await app.request(
      "/public/events/hackfest/registrations",
      json({
        teamName: "Null Pointers",
        payMode: "split",
        members: [
          { name: "Asha Rao", email: "asha@example.edu" },
          { name: "Ben Ortiz", email: "ben@example.edu" },
          { name: "Chen Wei", email: "chen@example.edu" },
        ],
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { feeCents: number; members: { payLink: string; shareCents: number }[] };
    expect(body.feeCents).toBe(7500);
    expect(body.members.map((m) => m.shareCents)).toEqual([2500, 2500, 2500]);
    payLinks = body.members.map((m) => m.payLink);
    expect(payLinks[0]).toMatch(/^http:\/\/app\.test\/e\/hackfest\/pay\/[\w-]{20,}$/);
  });

  it("rejects duplicate member emails", async () => {
    const res = await app.request(
      "/public/events/hackfest/registrations",
      json({ teamName: "Dupes", payMode: "team", members: [{ name: "A", email: "a@x.io" }, { name: "B", email: "A@x.io" }] }),
    );
    expect(res.status).toBe(400);
  });

  it("shows what a member owes from their link", async () => {
    const token = payLinks[1]!.split("/").pop();
    const res = await app.request(`/public/pay/${token}`);
    const body = (await res.json()) as { memberDueCents: number; teamOutstandingCents: number; member: { name: string } };
    expect(body).toMatchObject({ memberDueCents: 2500, teamOutstandingCents: 7500, member: { name: "Ben Ortiz" } });
  });

  it("returns 503 for checkout when PayPal is not configured", async () => {
    const res = await app.request("/public/orders", json({ token: payLinks[0]!.split("/").pop(), scope: "team" }));
    expect(res.status).toBe(503);
  });

  it("drafts nudges for a partially paid team", async () => {
    const db = await getDb();
    // Asha paid her share (as the capture handler would record it).
    await db.update(schema.members).set({ paidCents: 2500 }).where(eq(schema.members.email, "asha@example.edu"));
    await db.update(schema.registrations).set({ paidCents: 2500, status: "partially_paid" });

    const res = await app.request("/api/events/evt_1/nudges/scan", json({ deadline: "Friday 17 October" }));
    const body = (await res.json()) as { drafts: { to: string; body: string; source: string; id: string }[] };
    expect(body.drafts.map((d) => d.to).sort()).toEqual(["ben@example.edu", "chen@example.edu"]);
    expect(body.drafts[0]!.source).toBe("template");
    expect(body.drafts[0]!.body).toContain("1 of 3 people on Null Pointers have paid");
    expect(body.drafts[0]!.body).toContain("http://app.test/e/hackfest/pay/");

    const sent = await app.request(`/api/messages/${body.drafts[0]!.id}/send`, { method: "POST" });
    expect(sent.status).toBe(200);
    const again = (await (await app.request("/api/events/evt_1/nudges/scan", json({ dryRun: true }))).json()) as {
      drafts: unknown[];
      skipped: { reason: string }[];
    };
    expect(again.drafts).toHaveLength(1);
    expect(again.skipped).toEqual([expect.objectContaining({ reason: "cooldown" })]);
  });

  it("previews and proposes a prize batch, idempotently", async () => {
    const db = await getDb();
    await db.update(schema.registrations).set({ status: "paid" });

    const bad = await app.request("/api/events/evt_1/prizes/preview", json({ text: "place,team,amount\n1,Null Pointer,1000", budgetLineId: "bl_prizes" }));
    const badBody = (await bad.json()) as { preview: { ok: boolean; issues: { code: string; suggestion?: string }[] } };
    expect(badBody.preview.ok).toBe(false);
    expect(badBody.preview.issues[0]).toMatchObject({ code: "team_not_found", suggestion: "Null Pointers" });

    const req = { text: "place,team,amount\n1,Null Pointers,1000", budgetLineId: "bl_prizes", splitMode: "equal" };
    const first = await app.request("/api/events/evt_1/prizes/propose", json(req));
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { spendRequestId: string; proposal: { items: { amountCents: number }[] } };
    expect(firstBody.proposal.items.map((i) => i.amountCents)).toEqual([33334, 33333, 33333]);

    const second = await app.request("/api/events/evt_1/prizes/propose", json(req));
    expect(await second.json()).toMatchObject({ duplicate: true, spendRequestId: firstBody.spendRequestId });
  });

  it("explains a spend request after the policy engine decides", async () => {
    const db = await getDb();
    const [req] = await db.select().from(schema.spendRequests);
    const notYet = await app.request(`/api/spend-requests/${req!.id}/explain`, { method: "POST" });
    expect(notYet.status).toBe(409);

    await db
      .update(schema.spendRequests)
      .set({
        policyResult: {
          outcome: "needs_approval",
          rules: [{ rule: "per_transaction_cap", passed: true, detail: "each item under $2,000" }],
          aiFlags: [],
          approvers: ["treasurer", "faculty_advisor"],
          tierMaxCents: 200000,
        },
      })
      .where(eq(schema.spendRequests.id, req!.id));
    const res = await app.request(`/api/spend-requests/${req!.id}/explain`, { method: "POST" });
    const card = (await res.json()) as { headline: string; body: string };
    expect(card.headline).toBe("$1,000.00 prize payout to 3 recipients");
    expect(card.body).toContain("leaving $1,000.00 (50% used)");
    expect(card.body).toContain("the treasurer and the faculty advisor");
  });

  it("accepts a receipt upload once and rejects the duplicate", async () => {
    const form = () => {
      const f = new FormData();
      f.set("name", "Priya Shah");
      f.set("email", "Priya@example.edu");
      f.set("receipt", new File([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], "pizza.jpg", { type: "image/jpeg" }));
      return f;
    };
    const res = await app.request("/public/events/hackfest/receipts", { method: "POST", body: form() });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ registeredVolunteer: true });
    const dup = await app.request("/public/events/hackfest/receipts", { method: "POST", body: form() });
    expect(dup.status).toBe(409);
  });
});

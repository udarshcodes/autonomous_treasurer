
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq, schema, type Db } from "@treasurer/db";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  nightlyCrossCheckWithDb,
  type ReconDateWindow,
} from "./nightly";
import type { PayPalTransactionForRecon } from "./index";

const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../db/migrations",
);

const window: ReconDateWindow = {
  startDate: "2026-10-18T00:00:00.000Z",
  endDate: "2026-10-19T00:00:00.000Z",
};

describe("nightlyCrossCheckWithDb", () => {
  let client: PGlite;
  let db: Db;

  beforeEach(async () => {
    client = new PGlite("memory://");
    db = drizzle(client, { schema }) as unknown as Db;

    await migrate(db as never, { migrationsFolder });

    await db.insert(schema.events).values([
      { id: "event-a", slug: "event-a", name: "Event A" },
      { id: "event-b", slug: "event-b", name: "Event B" },
    ]);

    await db.insert(schema.ledgerEntries).values([
      {
        id: "ledger-matched",
        eventId: "event-a",
        direction: "in",
        amountCents: 2500,
        paypalObjectType: "capture",
        paypalObjectId: "capture-matched",
        businessObjectType: "registration",
        businessObjectId: "reg-matched",
      },
      {
        id: "ledger-flagged",
        eventId: "event-a",
        direction: "in",
        amountCents: 3000,
        paypalObjectType: "capture",
        paypalObjectId: "capture-flagged",
        businessObjectType: "registration",
        businessObjectId: "reg-flagged",
      },
      {
        id: "ledger-unmatched",
        eventId: "event-a",
        direction: "in",
        amountCents: 4500,
        businessObjectType: "registration",
        businessObjectId: "reg-unmatched",
      },
      {
        id: "ledger-other-event",
        eventId: "event-b",
        direction: "in",
        amountCents: 5000,
        businessObjectType: "registration",
        businessObjectId: "reg-other",
      },
    ]);
  });

  afterEach(async () => {
    await client.close();
  });

  it("reports confirmed, flagged, and unmatched ledger results", async () => {
    const transactions: PayPalTransactionForRecon[] = [
      {
        id: "capture-matched",
        type: "capture",
        amountCents: 2500,
        customId: "reg:reg-matched",
      },
      {
        id: "capture-flagged",
        type: "capture",
        amountCents: 2800,
        customId: "reg:reg-flagged",
      },
    ];

    const report = await nightlyCrossCheckWithDb(
      db,
      "event-a",
      transactions,
      window,
    );

    expect(
      report.confirmedMatches.map((result) => result.ledgerEntryId),
    ).toContain("ledger-matched");

    expect(
      report.flaggedMatches.map((result) => result.ledgerEntryId),
    ).toContain("ledger-flagged");

    expect(
      report.unmatchedLedgerEntries.map((result) => result.ledgerEntryId),
    ).toContain("ledger-unmatched");

    expect(report.totalTransactionsReceived).toBe(2);
    expect(report.eventId).toBe("event-a");
    expect(report.dateWindow).toEqual(window);
    expect(report.dateWindowVerified).toBe(false);

    expect(report.notes.join(" ")).toContain(
      "transaction timestamps and complete window coverage have not been verified",
    );

    expect(Number.isNaN(Date.parse(report.checkedAt))).toBe(false);
  });

  it("reports unassociated transactions without claiming they are global orphans", async () => {
    const transactions: PayPalTransactionForRecon[] = [
      {
        id: "capture-matched",
        type: "capture",
        amountCents: 2500,
        customId: "reg:reg-matched",
      },
      {
        id: "unassociated-transaction",
        type: "capture",
        amountCents: 9999,
        customId: "reg:unknown",
      },
    ];

    const report = await nightlyCrossCheckWithDb(
      db,
      "event-a",
      transactions,
      window,
    );

    expect(
      report.unassociatedTransactions.map((transaction) => transaction.id),
    ).toContain("unassociated-transaction");

    expect(report.notes.join(" ")).toContain(
      "not confirmed global orphans",
    );
  });

  it("does not modify financial fields or another event's ledger", async () => {
    const transactions: PayPalTransactionForRecon[] = [
      {
        id: "capture-matched",
        type: "capture",
        amountCents: 2500,
        customId: "reg:reg-matched",
      },
    ];

    await nightlyCrossCheckWithDb(db, "event-a", transactions, window);

    const rows = await db
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.eventId, "event-a"));

    const matched = rows.find((row) => row.id === "ledger-matched");

    expect(matched?.amountCents).toBe(2500);
    expect(matched?.direction).toBe("in");
    expect(matched?.paypalObjectId).toBe("capture-matched");

    const otherEvent = await db
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.id, "ledger-other-event"));

    expect(otherEvent[0]?.reconStatus).toBe("unmatched");
    expect(otherEvent[0]?.reconNote).toBeNull();
  });

  it("rejects an invalid date window before updating the database", async () => {
    await expect(
      nightlyCrossCheckWithDb(db, "event-a", [], {
        startDate: "2026-10-20T00:00:00.000Z",
        endDate: "2026-10-19T00:00:00.000Z",
      }),
    ).rejects.toThrow("startDate must be earlier than endDate");

    const rows = await db
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.id, "ledger-matched"));

    expect(rows[0]?.reconStatus).toBe("unmatched");
  });
});

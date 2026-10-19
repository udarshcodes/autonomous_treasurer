
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq, schema, type Db } from "@treasurer/db";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  matchLedgerWithDb,
  type PayPalTransactionForRecon,
} from "./index";

const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../db/migrations",
);

describe("matchLedgerWithDb integration", () => {
  let client: PGlite;
  let db: Db;

  beforeEach(async () => {
    client = new PGlite("memory://");
    db = drizzle(client, { schema }) as unknown as Db;

    await migrate(db as never, { migrationsFolder });

    await db.insert(schema.events).values([
      {
        id: "event-a",
        slug: "event-a",
        name: "Event A",
      },
      {
        id: "event-b",
        slug: "event-b",
        name: "Event B",
      },
    ]);

    await db.insert(schema.ledgerEntries).values([
      {
        id: "ledger-a",
        eventId: "event-a",
        direction: "in",
        amountCents: 2500,
        paypalObjectType: "capture",
        paypalObjectId: "capture-a",
        businessObjectType: "registration",
        businessObjectId: "reg-a",
      },
      {
        id: "ledger-a2",
        eventId: "event-a",
        direction: "in",
        amountCents: 3000,
        paypalObjectType: "capture",
        paypalObjectId: "capture-a2",
        businessObjectType: "registration",
        businessObjectId: "reg-a2",
      },
      {
        id: "ledger-b",
        eventId: "event-b",
        direction: "in",
        amountCents: 4000,
        paypalObjectType: "capture",
        paypalObjectId: "capture-b",
        businessObjectType: "registration",
        businessObjectId: "reg-b",
      },
    ]);
  });

  afterEach(async () => {
    await client.close();
  });

  it("only reconciles ledger entries for the requested event", async () => {
    const transactions: PayPalTransactionForRecon[] = [
      {
        id: "capture-a",
        type: "capture",
        amountCents: 2500,
        customId: "reg:reg-a",
      },
    ];

    await matchLedgerWithDb(db, "event-a", transactions);

    const eventBLedger = await db
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.id, "ledger-b"));

    expect(eventBLedger[0]?.reconStatus).toBe("unmatched");
    expect(eventBLedger[0]?.reconNote).toBeNull();
    expect(eventBLedger[0]?.amountCents).toBe(4000);
  });

  it("persists reconciliation status and explanation", async () => {
    const transactions: PayPalTransactionForRecon[] = [
      {
        id: "capture-a",
        type: "capture",
        amountCents: 2000,
        customId: "reg:reg-a",
      },
    ];

    const results = await matchLedgerWithDb(db, "event-a", transactions);

    expect(results[0]?.status).toBe("flagged");
    expect(results[0]?.explanation).toBeTruthy();

    const rows = await db
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.id, "ledger-a"));

    expect(rows[0]?.reconStatus).toBe("flagged");
    expect(rows[0]?.reconNote).toBe(results[0]?.explanation);
  });

  it("does not modify financial fields or PayPal identifiers", async () => {
    const transactions: PayPalTransactionForRecon[] = [
      {
        id: "capture-a",
        type: "capture",
        amountCents: 2500,
        customId: "reg:reg-a",
      },
    ];

    await matchLedgerWithDb(db, "event-a", transactions);

    const rows = await db
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.id, "ledger-a"));

    expect(rows[0]?.amountCents).toBe(2500);
    expect(rows[0]?.direction).toBe("in");
    expect(rows[0]?.paypalObjectId).toBe("capture-a");
  });

  it("produces consistent results when run repeatedly", async () => {
    const transactions: PayPalTransactionForRecon[] = [
      {
        id: "capture-a",
        type: "capture",
        amountCents: 2500,
        customId: "reg:reg-a",
      },
    ];

    const first = await matchLedgerWithDb(db, "event-a", transactions);
    const second = await matchLedgerWithDb(db, "event-a", transactions);

    expect(second).toEqual(first);

    const rows = await db
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.id, "ledger-a"));

    expect(rows[0]?.reconStatus).toBe("matched");
    expect(rows[0]?.amountCents).toBe(2500);
  });

  it("rolls back all reconciliation updates if a later update fails", async () => {
    // Make the update to ledger-a2 fail deliberately.
    await client.exec(`
      CREATE FUNCTION reject_ledger_a2_recon()
      RETURNS trigger AS $$
      BEGIN
        IF NEW.id = 'ledger-a2' THEN
          RAISE EXCEPTION 'forced reconciliation failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER reject_ledger_a2_recon_trigger
      BEFORE UPDATE ON ledger_entries
      FOR EACH ROW
      EXECUTE FUNCTION reject_ledger_a2_recon();
    `);

    const transactions: PayPalTransactionForRecon[] = [
      {
        id: "capture-a",
        type: "capture",
        amountCents: 2500,
        customId: "reg:reg-a",
      },
      {
        id: "capture-a2",
        type: "capture",
        amountCents: 3000,
        customId: "reg:reg-a2",
      },
    ];

    await expect(
      matchLedgerWithDb(db, "event-a", transactions),
    ).rejects.toThrow();

    const rows = await db
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.eventId, "event-a"));

    // Both entries must remain unchanged if the transaction rolled back.
    expect(rows.every((row) => row.reconStatus === "unmatched")).toBe(true);
    expect(rows.every((row) => row.reconNote === null)).toBe(true);
    expect(rows.find((row) => row.id === "ledger-a")?.amountCents).toBe(2500);
    expect(rows.find((row) => row.id === "ledger-a2")?.amountCents).toBe(3000);
  });
});

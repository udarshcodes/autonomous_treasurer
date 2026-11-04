
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq, schema, type Db } from "@treasurer/db";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildClosingStatementWithDb } from "./statement";

const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../db/migrations",
);

describe("buildClosingStatementWithDb", () => {
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
        currency: "USD",
      },
      {
        id: "event-b",
        slug: "event-b",
        name: "Event B",
        currency: "INR",
      },
    ]);

    await db.insert(schema.ledgerEntries).values([
      {
        id: "entry-1",
        eventId: "event-a",
        direction: "in",
        amountCents: 10000,
        reconStatus: "matched",
      },
      {
        id: "entry-2",
        eventId: "event-a",
        direction: "in",
        amountCents: 2500,
        reconStatus: "unmatched",
      },
      {
        id: "entry-3",
        eventId: "event-a",
        direction: "out",
        amountCents: 3000,
        reconStatus: "flagged",
      },
      {
        id: "entry-4",
        eventId: "event-a",
        direction: "out",
        amountCents: 1500,
        reconStatus: "suggested",
      },
      {
        id: "entry-5",
        eventId: "event-b",
        direction: "in",
        amountCents: 99999,
        reconStatus: "matched",
      },
    ]);
  });

  afterEach(async () => {
    await client.close();
  });

  it("calculates income, expenses, net, and reconciliation counts", async () => {
    const statement = await buildClosingStatementWithDb(db, "event-a");

    expect(statement).toEqual({
      eventId: "event-a",
      currency: "USD",
      incomeCents: 12500,
      expenseCents: 4500,
      netCents: 8000,
      matchedEntries: 1,
      unmatchedEntries: 1,
      flaggedEntries: 1,
      suggestedEntries: 1,
      unresolvedEntries: 3,
    });
  });

  it("isolates the statement to the requested event", async () => {
    const statement = await buildClosingStatementWithDb(db, "event-b");

    expect(statement.currency).toBe("INR");
    expect(statement.incomeCents).toBe(99999);
    expect(statement.expenseCents).toBe(0);
    expect(statement.netCents).toBe(99999);
    expect(statement.matchedEntries).toBe(1);
    expect(statement.unresolvedEntries).toBe(0);
  });

  it("returns zero totals when the event has no ledger entries", async () => {
    await db.insert(schema.events).values({
      id: "empty-event",
      slug: "empty-event",
      name: "Empty Event",
      currency: "USD",
    });

    const statement = await buildClosingStatementWithDb(db, "empty-event");

    expect(statement.incomeCents).toBe(0);
    expect(statement.expenseCents).toBe(0);
    expect(statement.netCents).toBe(0);
    expect(statement.unresolvedEntries).toBe(0);
  });

  it("rejects an empty event ID", async () => {
    await expect(
      buildClosingStatementWithDb(db, " "),
    ).rejects.toThrow("eventId must not be empty");
  });

  it("rejects an event that does not exist", async () => {
    await expect(
      buildClosingStatementWithDb(db, "missing-event"),
    ).rejects.toThrow("Event not found: missing-event");
  });

  it("does not modify ledger entries", async () => {
    const before = await db
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.eventId, "event-a"));

    await buildClosingStatementWithDb(db, "event-a");

    const after = await db
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.eventId, "event-a"));

    expect(after).toEqual(before);
  });
});

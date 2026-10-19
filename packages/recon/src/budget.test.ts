
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq, schema, type Db } from "@treasurer/db";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildBudgetReportWithDb } from "./budget";

const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../db/migrations",
);

describe("buildBudgetReportWithDb", () => {
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
        startsOn: "2026-10-01",
        endsOn: "2026-10-11",
      },
      {
        id: "event-b",
        slug: "event-b",
        name: "Event B",
        currency: "INR",
      },
    ]);

    await db.insert(schema.budgetLines).values([
      {
        id: "budget-a",
        eventId: "event-a",
        name: "Catering",
        category: "food",
        allocatedCents: 10000,
        spentCents: 999999,
      },
      {
        id: "budget-b",
        eventId: "event-a",
        name: "Venue",
        category: "venue",
        allocatedCents: 5000,
        spentCents: 0,
      },
      {
        id: "budget-c",
        eventId: "event-a",
        name: "No allocation",
        category: "other",
        allocatedCents: 0,
        spentCents: 0,
      },
      {
        id: "budget-other",
        eventId: "event-b",
        name: "Other event",
        category: "other",
        allocatedCents: 7000,
        spentCents: 0,
      },
    ]);

    await db.insert(schema.ledgerEntries).values([
      {
        id: "expense-1",
        eventId: "event-a",
        direction: "out",
        amountCents: 3000,
        budgetLineId: "budget-a",
        reconStatus: "matched",
        occurredAt: new Date("2026-10-03T12:00:00.000Z"),
      },
      {
        id: "expense-2",
        eventId: "event-a",
        direction: "out",
        amountCents: 2000,
        budgetLineId: "budget-a",
        reconStatus: "unmatched",
        occurredAt: new Date("2026-10-05T12:00:00.000Z"),
      },
      {
        id: "expense-3",
        eventId: "event-a",
        direction: "out",
        amountCents: 6000,
        budgetLineId: "budget-b",
        reconStatus: "flagged",
        occurredAt: new Date("2026-10-05T12:00:00.000Z"),
      },
      {
        id: "income-1",
        eventId: "event-a",
        direction: "in",
        amountCents: 100000,
        budgetLineId: "budget-a",
        reconStatus: "matched",
        occurredAt: new Date("2026-10-04T12:00:00.000Z"),
      },
      {
        id: "expense-other",
        eventId: "event-b",
        direction: "out",
        amountCents: 6500,
        budgetLineId: "budget-other",
        reconStatus: "matched",
        occurredAt: new Date("2026-10-05T12:00:00.000Z"),
      },
    ]);
  });

  afterEach(async () => {
    await client.close();
  });

  it("calculates actual spend from outgoing ledger entries", async () => {
    const report = await buildBudgetReportWithDb(db, "event-a");

    const catering = report.lines.find((line) => line.budgetLineId === "budget-a");

    expect(catering?.allocatedCents).toBe(10000);
    expect(catering?.actualSpentCents).toBe(5000);
    expect(catering?.remainingCents).toBe(5000);
    expect(catering?.varianceCents).toBe(5000);
    expect(catering?.percentUsed).toBe(50);
    expect(catering?.actualSpentCents).not.toBe(999999);
  });

  it("reports overspending as a negative remaining balance", async () => {
    const report = await buildBudgetReportWithDb(db, "event-a");

    const venue = report.lines.find((line) => line.budgetLineId === "budget-b");

    expect(venue?.allocatedCents).toBe(5000);
    expect(venue?.actualSpentCents).toBe(6000);
    expect(venue?.remainingCents).toBe(-1000);
    expect(venue?.varianceCents).toBe(-1000);
    expect(venue?.percentUsed).toBe(120);
  });

  it("calculates totals without counting income as spending", async () => {
    const report = await buildBudgetReportWithDb(db, "event-a");

    expect(report.currency).toBe("USD");
    expect(report.totalAllocatedCents).toBe(15000);
    expect(report.totalActualSpentCents).toBe(11000);
    expect(report.totalRemainingCents).toBe(4000);
    expect(report.totalVarianceCents).toBe(4000);
    expect(report.unallocatedExpenseCents).toBe(0);
    expect(report.unallocatedExpenseCount).toBe(0);
  });

  it("returns null percentage when allocation is zero", async () => {
    const report = await buildBudgetReportWithDb(db, "event-a");

    const line = report.lines.find((item) => item.budgetLineId === "budget-c");

    expect(line?.actualSpentCents).toBe(0);
    expect(line?.percentUsed).toBeNull();
  });

  it("projects spend using elapsed event time", async () => {
    const report = await buildBudgetReportWithDb(db, "event-a", {
      asOfDate: "2026-10-06",
    });

    const catering = report.lines.find((line) => line.budgetLineId === "budget-a");

    expect(catering?.projectedSpendCents).toBe(10000);
    expect(catering?.projectedOverBudgetCents).toBe(0);

    const venue = report.lines.find((line) => line.budgetLineId === "budget-b");

    expect(venue?.projectedSpendCents).toBe(12000);
    expect(venue?.projectedOverBudgetCents).toBe(7000);
  });

  it("excludes expenses occurring after the requested historical date", async () => {
    await db.insert(schema.ledgerEntries).values({
      id: "future-expense",
      eventId: "event-a",
      direction: "out",
      amountCents: 4000,
      budgetLineId: "budget-a",
      reconStatus: "matched",
      occurredAt: new Date("2026-10-08T12:00:00.000Z"),
    });

    const report = await buildBudgetReportWithDb(db, "event-a", {
      asOfDate: "2026-10-06",
    });

    const catering = report.lines.find((line) => line.budgetLineId === "budget-a");

    expect(catering?.actualSpentCents).toBe(5000);
    expect(catering?.projectedSpendCents).toBe(10000);
  });

  it("reports expenses without a budget line as unallocated", async () => {
    await db.insert(schema.ledgerEntries).values({
      id: "unallocated-expense",
      eventId: "event-a",
      direction: "out",
      amountCents: 1250,
      budgetLineId: null,
      reconStatus: "unmatched",
      occurredAt: new Date("2026-10-05T12:00:00.000Z"),
    });

    const report = await buildBudgetReportWithDb(db, "event-a");

    expect(report.unallocatedExpenseCents).toBe(1250);
    expect(report.unallocatedExpenseCount).toBe(1);
    expect(report.totalActualSpentCents).toBe(11000);
  });

  it("treats another event's budget line as unallocated", async () => {
    await db.insert(schema.ledgerEntries).values({
      id: "misassigned-expense",
      eventId: "event-a",
      direction: "out",
      amountCents: 900,
      budgetLineId: "budget-other",
      reconStatus: "flagged",
      occurredAt: new Date("2026-10-05T12:00:00.000Z"),
    });

    const report = await buildBudgetReportWithDb(db, "event-a");

    expect(report.unallocatedExpenseCents).toBe(900);
    expect(report.unallocatedExpenseCount).toBe(1);
    expect(report.totalActualSpentCents).toBe(11000);
  });

  it("does not project when event dates are unavailable", async () => {
    const report = await buildBudgetReportWithDb(db, "event-b");

    const line = report.lines.find((item) => item.budgetLineId === "budget-other");

    expect(line?.projectedSpendCents).toBeNull();
    expect(line?.projectedOverBudgetCents).toBeNull();
  });

  it("isolates reports to the requested event", async () => {
    const report = await buildBudgetReportWithDb(db, "event-b");

    expect(report.lines).toHaveLength(1);
    expect(report.lines[0]?.budgetLineId).toBe("budget-other");
    expect(report.totalAllocatedCents).toBe(7000);
    expect(report.totalActualSpentCents).toBe(6500);
  });

  it("rejects empty and nonexistent event IDs", async () => {
    await expect(
      buildBudgetReportWithDb(db, " "),
    ).rejects.toThrow("eventId must not be empty");

    await expect(
      buildBudgetReportWithDb(db, "missing-event"),
    ).rejects.toThrow("Event not found: missing-event");
  });

  it("rejects an invalid projection date", async () => {
    await expect(
      buildBudgetReportWithDb(db, "event-a", {
        asOfDate: "2026-02-30",
      }),
    ).rejects.toThrow("asOfDate must be a valid YYYY-MM-DD date");
  });

  it("does not modify ledger entries or budget lines", async () => {
    const ledgerBefore = await db
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.eventId, "event-a"));

    const budgetBefore = await db
      .select()
      .from(schema.budgetLines)
      .where(eq(schema.budgetLines.eventId, "event-a"));

    await buildBudgetReportWithDb(db, "event-a", {
      asOfDate: "2026-10-06",
    });

    const ledgerAfter = await db
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.eventId, "event-a"));

    const budgetAfter = await db
      .select()
      .from(schema.budgetLines)
      .where(eq(schema.budgetLines.eventId, "event-a"));

    expect(ledgerAfter).toEqual(ledgerBefore);
    expect(budgetAfter).toEqual(budgetBefore);
  });
});

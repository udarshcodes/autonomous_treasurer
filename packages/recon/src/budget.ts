
import { getDb, schema, eq, type Db } from "@treasurer/db";

export interface BudgetLineReport {
  budgetLineId: string;
  name: string;
  category: string;
  allocatedCents: number;
  actualSpentCents: number;
  remainingCents: number;
  varianceCents: number;
  percentUsed: number | null;
  projectedSpendCents: number | null;
  projectedOverBudgetCents: number | null;
}

export interface BudgetReport {
  eventId: string;
  currency: string;
  lines: BudgetLineReport[];
  totalAllocatedCents: number;
  totalActualSpentCents: number;
  totalRemainingCents: number;
  totalVarianceCents: number;
  unallocatedExpenseCents: number;
  unallocatedExpenseCount: number;
}

export interface BudgetReportOptions {
  /** Reference date for reporting and projections, formatted as YYYY-MM-DD. */
  asOfDate?: string;
}

function parseDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return timestamp;
}

function validateCents(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid non-negative integer cents: ${label}`);
  }
}

function safeSum(values: number[], label: string): number {
  let total = 0;

  for (const value of values) {
    total += value;

    if (!Number.isSafeInteger(total)) {
      throw new Error(`Budget total exceeds safe integer range: ${label}`);
    }
  }

  return total;
}

export async function buildBudgetReportWithDb(
  db: Db,
  eventId: string,
  options: BudgetReportOptions = {},
): Promise<BudgetReport> {
  if (!eventId.trim()) {
    throw new Error("eventId must not be empty");
  }

  const [events, budgetLines, ledgerEntries] = await Promise.all([
    db.select().from(schema.events).where(eq(schema.events.id, eventId)),
    db.select().from(schema.budgetLines).where(eq(schema.budgetLines.eventId, eventId)),
    db.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.eventId, eventId)),
  ]);

  const event = events[0];

  if (!event) {
    throw new Error(`Event not found: ${eventId}`);
  }

  const asOfTimestamp = options.asOfDate
    ? parseDate(options.asOfDate)
    : null;

  if (options.asOfDate && asOfTimestamp === null) {
    throw new Error("asOfDate must be a valid YYYY-MM-DD date");
  }

  // Include expenses through the end of the requested UTC date.
  const cutoff = asOfTimestamp === null
    ? null
    : asOfTimestamp + 24 * 60 * 60 * 1000;

  const actualByBudgetLine = new Map<string, number>();
  const validBudgetLineIds = new Set(budgetLines.map((line) => line.id));

  let unallocatedExpenseCents = 0;
  let unallocatedExpenseCount = 0;

  for (const entry of ledgerEntries) {
    if (entry.direction !== "out") continue;

    if (cutoff !== null) {
      const occurredAt = new Date(entry.occurredAt).getTime();

      if (!Number.isFinite(occurredAt)) {
        throw new Error(`Invalid occurredAt timestamp: ${entry.id}`);
      }

      if (occurredAt >= cutoff) continue;
    }

    validateCents(entry.amountCents, `ledger entry ${entry.id}`);

    if (
      !entry.budgetLineId ||
      !validBudgetLineIds.has(entry.budgetLineId)
    ) {
      unallocatedExpenseCents += entry.amountCents;
      unallocatedExpenseCount += 1;

      if (
        !Number.isSafeInteger(unallocatedExpenseCents) ||
        !Number.isSafeInteger(unallocatedExpenseCount)
      ) {
        throw new Error("Unallocated expense totals exceed safe integer range");
      }

      continue;
    }

    const current = actualByBudgetLine.get(entry.budgetLineId) ?? 0;
    const next = current + entry.amountCents;

    if (!Number.isSafeInteger(next)) {
      throw new Error(
        `Spending total exceeds safe integer range: ${entry.budgetLineId}`,
      );
    }

    actualByBudgetLine.set(entry.budgetLineId, next);
  }

  const eventStart = event.startsOn ? parseDate(event.startsOn) : null;
  const eventEnd = event.endsOn ? parseDate(event.endsOn) : null;

  const hasValidPeriod =
    eventStart !== null &&
    eventEnd !== null &&
    eventEnd > eventStart;

  const projectionTimestamp = asOfTimestamp ?? Date.now();

  const projectionProgress =
    hasValidPeriod
      ? Math.min(
          1,
          Math.max(
            0,
            (projectionTimestamp - eventStart) / (eventEnd - eventStart),
          ),
        )
      : null;

  const lines: BudgetLineReport[] = budgetLines.map((line) => {
    validateCents(line.allocatedCents, `budget line ${line.id}`);

    const actualSpentCents = actualByBudgetLine.get(line.id) ?? 0;
    const remainingCents = line.allocatedCents - actualSpentCents;
    const varianceCents = remainingCents;

    let projectedSpendCents: number | null = null;
    let projectedOverBudgetCents: number | null = null;

    // This is a simple linear run-rate estimate, not a predictive model.
    if (projectionProgress !== null && projectionProgress > 0) {
      projectedSpendCents = Math.round(
        actualSpentCents / projectionProgress,
      );

      if (!Number.isSafeInteger(projectedSpendCents)) {
        throw new Error(
          `Projected spend exceeds safe integer range: ${line.id}`,
        );
      }

      projectedOverBudgetCents = Math.max(
        0,
        projectedSpendCents - line.allocatedCents,
      );
    }

    return {
      budgetLineId: line.id,
      name: line.name,
      category: line.category,
      allocatedCents: line.allocatedCents,
      actualSpentCents,
      remainingCents,
      varianceCents,
      percentUsed:
        line.allocatedCents === 0
          ? null
          : Math.round(
              (actualSpentCents / line.allocatedCents) * 100,
            ),
      projectedSpendCents,
      projectedOverBudgetCents,
    };
  });

  const totalAllocatedCents = safeSum(
    lines.map((line) => line.allocatedCents),
    "allocated budget",
  );

  const totalActualSpentCents = safeSum(
    lines.map((line) => line.actualSpentCents),
    "actual spending",
  );

  const totalRemainingCents =
    totalAllocatedCents - totalActualSpentCents;

  if (!Number.isSafeInteger(totalRemainingCents)) {
    throw new Error("Remaining budget exceeds safe integer range");
  }

  return {
    eventId,
    currency: event.currency,
    lines,
    totalAllocatedCents,
    totalActualSpentCents,
    totalRemainingCents,
    totalVarianceCents: totalRemainingCents,
    unallocatedExpenseCents,
    unallocatedExpenseCount,
  };
}

export async function buildBudgetReport(
  eventId: string,
  options: BudgetReportOptions = {},
): Promise<BudgetReport> {
  return buildBudgetReportWithDb(await getDb(), eventId, options);
}

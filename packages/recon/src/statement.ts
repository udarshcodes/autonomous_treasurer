
import { getDb, schema, eq, type Db } from "@treasurer/db";

export interface ClosingStatement {
  eventId: string;
  currency: string;
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  matchedEntries: number;
  unmatchedEntries: number;
  flaggedEntries: number;
  suggestedEntries: number;
  unresolvedEntries: number;
}

export async function buildClosingStatementWithDb(
  db: Db,
  eventId: string,
): Promise<ClosingStatement> {
  if (!eventId.trim()) {
    throw new Error("eventId must not be empty");
  }

  const [eventRows, ledgerRows] = await Promise.all([
    db.select().from(schema.events).where(eq(schema.events.id, eventId)),
    db
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.eventId, eventId)),
  ]);

  const event = eventRows[0];
  if (!event) {
    throw new Error(`Event not found: ${eventId}`);
  }

  let incomeCents = 0;
  let expenseCents = 0;
  let matchedEntries = 0;
  let unmatchedEntries = 0;
  let flaggedEntries = 0;
  let suggestedEntries = 0;

  for (const entry of ledgerRows) {
    if (!Number.isSafeInteger(entry.amountCents) || entry.amountCents < 0) {
      throw new Error(`Invalid amount on ledger entry: ${entry.id}`);
    }

    if (entry.direction === "in") {
      incomeCents += entry.amountCents;
    } else {
      expenseCents += entry.amountCents;
    }

    switch (entry.reconStatus) {
      case "matched":
        matchedEntries++;
        break;
      case "unmatched":
        unmatchedEntries++;
        break;
      case "flagged":
        flaggedEntries++;
        break;
      case "suggested":
        suggestedEntries++;
        break;
    }
  }

  if (
    !Number.isSafeInteger(incomeCents) ||
    !Number.isSafeInteger(expenseCents)
  ) {
    throw new Error("Ledger totals exceed the safe integer range");
  }

  const netCents = incomeCents - expenseCents;
  if (!Number.isSafeInteger(netCents)) {
    throw new Error("Net total exceeds the safe integer range");
  }

  return {
    eventId,
    currency: event.currency,
    incomeCents,
    expenseCents,
    netCents,
    matchedEntries,
    unmatchedEntries,
    flaggedEntries,
    suggestedEntries,
    unresolvedEntries:
      unmatchedEntries + flaggedEntries + suggestedEntries,
  };
}

export async function buildClosingStatement(
  eventId: string,
): Promise<ClosingStatement> {
  return buildClosingStatementWithDb(await getDb(), eventId);
}

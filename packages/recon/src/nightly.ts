
import { getDb, type Db } from "@treasurer/db";
import {
  matchLedgerWithDb,
  type MatchResult,
  type PayPalTransactionForRecon,
} from "./index";

export interface ReconDateWindow {
  /** Inclusive UTC timestamp, ISO 8601 format. */
  startDate: string;
  /** Exclusive UTC timestamp, ISO 8601 format. */
  endDate: string;
}

export interface NightlyCrossCheckReport {
  eventId: string;
  dateWindow: ReconDateWindow;
  checkedAt: string;
  totalTransactionsReceived: number;
  confirmedMatches: MatchResult[];
  flaggedMatches: MatchResult[];
  suggestedMatches: MatchResult[];
  unmatchedLedgerEntries: MatchResult[];
  unassociatedTransactions: PayPalTransactionForRecon[];
  dateWindowVerified: false;
  notes: string[];
}

function validateInputs(
  eventId: string,
  window: ReconDateWindow,
): void {
  if (!eventId.trim()) {
    throw new Error("eventId must not be empty");
  }

  for (const [label, value] of [
    ["startDate", window.startDate],
    ["endDate", window.endDate],
  ] as const) {
    if (
      !value.endsWith("Z") ||
      !Number.isFinite(Date.parse(value))
    ) {
      throw new Error(
        `${label} must be a valid UTC ISO timestamp ending in Z`,
      );
    }
  }

  if (Date.parse(window.startDate) >= Date.parse(window.endDate)) {
    throw new Error("startDate must be earlier than endDate");
  }
}

/**
 * Builds a reconciliation report using an explicitly supplied database.
 *
 * The caller supplies the PayPal transaction batch, including all pages.
 * This function does not call PayPal. The date window is descriptive metadata:
 * transaction timestamps and complete window coverage are not verified.
 *
 * Only reconciliation metadata is updated. Financial ledger fields are
 * not created or modified.
 */
export async function nightlyCrossCheckWithDb(
  db: Db,
  eventId: string,
  transactions: PayPalTransactionForRecon[],
  window: ReconDateWindow,
): Promise<NightlyCrossCheckReport> {
  validateInputs(eventId, window);

  const results = await matchLedgerWithDb(db, eventId, transactions);

  const confirmedMatches = results.filter(
    (result) => result.status === "matched",
  );

  const flaggedMatches = results.filter(
    (result) => result.status === "flagged",
  );

  const suggestedMatches = results.filter(
    (result) => result.status === "suggested",
  );

  const unmatchedLedgerEntries = results.filter(
    (result) => result.status === "unmatched",
  );

  // A transaction referenced by a result has some association with this
  // event, even if that association is flagged or only suggested.
  // Remaining transactions are not necessarily global orphans.
  const associatedTransactionIds = new Set(
    results
      .map((result) => result.matchedTo?.id)
      .filter((id): id is string => Boolean(id)),
  );

  const unassociatedTransactions = transactions.filter(
    (transaction) => !associatedTransactionIds.has(transaction.id),
  );

  return {
    eventId,
    dateWindow: { ...window },
    checkedAt: new Date().toISOString(),
    totalTransactionsReceived: transactions.length,
    confirmedMatches,
    flaggedMatches,
    suggestedMatches,
    unmatchedLedgerEntries,
    unassociatedTransactions,
    dateWindowVerified: false,
    notes: [
      "PayPal transactions were supplied by the caller; no live PayPal request was made.",
      "The date window is descriptive metadata only; transaction timestamps and complete window coverage have not been verified.",
      "Unassociated transactions are unassociated with this event only; they are not confirmed global orphans.",
      "Suggested and flagged matches require investigation and are not confirmed reconciliations.",
      "This run updates reconciliation metadata only; it does not create or modify financial ledger entries.",
    ],
  };
}

/**
 * Application entry point using the shared application database.
 *
 * Can be called by the worker after PayPal Transaction Search is implemented.
 */
export async function nightlyCrossCheck(
  eventId: string,
  transactions: PayPalTransactionForRecon[],
  window: ReconDateWindow,
): Promise<NightlyCrossCheckReport> {
  const db = await getDb();

  return nightlyCrossCheckWithDb(db, eventId, transactions, window);
}

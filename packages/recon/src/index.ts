import { getDb, schema, eq, type Db } from "@treasurer/db";

/**
 * Reconciliation and data — owner: AI 4.
 *
 * Deterministic matching runs before any LLM explanation.
 * All monetary amounts are integer cents.
 */

export type ReconStatus =
  | "matched"
  | "flagged"
  | "suggested"
  | "unmatched";

export interface MatchResult {
  ledgerEntryId: string;
  status: ReconStatus;
  matchedTo?: { type: string; id: string };
  explanation?: string;
}

export interface LedgerEntryForRecon {
  id: string;
  amountCents: number;
  businessObjectType: string | null;
  businessObjectId: string | null;
  paypalObjectType: string | null;
  paypalObjectId: string | null;
}

export interface PayPalTransactionForRecon {
  id: string;
  type: string;
  amountCents: number;
  customId?: string | null;
}

function validateAmount(amountCents: number, label: string): void {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw new Error(
      `${label} must be a non-negative safe integer in cents`,
    );
  }
}

/**
 * Convert the business-object contract to PayPal custom_id.
 * Unknown business-object types are deliberately not guessed.
 */
function expectedCustomId(
  entry: LedgerEntryForRecon,
): string | undefined {
  if (!entry.businessObjectId) return undefined;

  if (entry.businessObjectType === "member") {
    return `mem:${entry.businessObjectId}`;
  }

  if (entry.businessObjectType === "registration") {
    return `reg:${entry.businessObjectId}`;
  }

  return undefined;
}

/**
 * Match ledger entries to PayPal transactions deterministically.
 *
 * Priority:
 * 1. Existing PayPal object ID.
 * 2. Exact custom_id derived from the business object.
 * 3. Amount-only evidence, which can suggest a match but never confirm it.
 *
 * Confirmed matches are one-to-one within this input batch.
 * This function is pure: it does not write to the database or move money.
 */
export function matchLedgerEntries(
  ledgerEntries: LedgerEntryForRecon[],
  transactions: PayPalTransactionForRecon[],
): MatchResult[] {
  for (const entry of ledgerEntries) {
    validateAmount(entry.amountCents, `Ledger entry ${entry.id} amount`);
  }

  for (const transaction of transactions) {
    validateAmount(
      transaction.amountCents,
      `PayPal transaction ${transaction.id} amount`,
    );
  }

  // Track transactions assigned to confirmed matches.
  const consumedTransactionIds = new Set<string>();

  return ledgerEntries.map((entry): MatchResult => {
    // Priority 1: match an existing PayPal object ID.
    if (entry.paypalObjectId) {
      const directMatches = transactions.filter(
        (transaction) => transaction.id === entry.paypalObjectId,
      );

      if (directMatches.length > 1) {
        return {
          ledgerEntryId: entry.id,
          status: "flagged",
          explanation:
            "Duplicate PayPal transaction IDs in reconciliation input.",
        };
      }

      const direct = directMatches[0];

      // A known ID that is absent from this search result must not be
      // silently replaced by a different transaction.
      if (!direct) {
        return {
          ledgerEntryId: entry.id,
          status: "unmatched",
          explanation:
            "The ledger references a PayPal object ID not present in the supplied transactions.",
        };
      }

      if (consumedTransactionIds.has(direct.id)) {
        return {
          ledgerEntryId: entry.id,
          status: "flagged",
          matchedTo: { type: direct.type, id: direct.id },
          explanation:
            "This PayPal transaction is already assigned to another ledger entry.",
        };
      }

      if (
        entry.paypalObjectType &&
        entry.paypalObjectType !== direct.type
      ) {
        return {
          ledgerEntryId: entry.id,
          status: "flagged",
          matchedTo: { type: direct.type, id: direct.id },
          explanation:
            "PayPal object type does not match the ledger entry.",
        };
      }

      if (entry.amountCents !== direct.amountCents) {
        return {
          ledgerEntryId: entry.id,
          status: "flagged",
          matchedTo: { type: direct.type, id: direct.id },
          explanation:
            "Ledger amount differs from the PayPal transaction amount.",
        };
      }

      const customId = expectedCustomId(entry);

      if (customId && direct.customId && customId !== direct.customId) {
        return {
          ledgerEntryId: entry.id,
          status: "flagged",
          matchedTo: { type: direct.type, id: direct.id },
          explanation:
            "PayPal custom_id conflicts with the ledger business object.",
        };
      }

      consumedTransactionIds.add(direct.id);

      return {
        ledgerEntryId: entry.id,
        status: "matched",
        matchedTo: { type: direct.type, id: direct.id },
        explanation: "Matched by PayPal object ID and amount.",
      };
    }

    // Priority 2: match the shared mem:<id> / reg:<id> contract.
    const customId = expectedCustomId(entry);

    if (customId) {
      const customMatches = transactions.filter(
        (transaction) => transaction.customId === customId,
      );

      if (customMatches.length > 1) {
        return {
          ledgerEntryId: entry.id,
          status: "flagged",
          explanation: `Multiple PayPal transactions use custom_id ${customId}; possible duplicate payment.`,
        };
      }

      const customMatch = customMatches[0];

      if (customMatch) {
        if (consumedTransactionIds.has(customMatch.id)) {
          return {
            ledgerEntryId: entry.id,
            status: "flagged",
            matchedTo: {
              type: customMatch.type,
              id: customMatch.id,
            },
            explanation:
              "This PayPal transaction is already assigned to another ledger entry.",
          };
        }

        if (entry.amountCents !== customMatch.amountCents) {
          return {
            ledgerEntryId: entry.id,
            status: "flagged",
            matchedTo: {
              type: customMatch.type,
              id: customMatch.id,
            },
            explanation: "custom_id matched, but the amounts differ.",
          };
        }

        consumedTransactionIds.add(customMatch.id);

        return {
          ledgerEntryId: entry.id,
          status: "matched",
          matchedTo: {
            type: customMatch.type,
            id: customMatch.id,
          },
          explanation: "Matched by custom_id and amount.",
        };
      }
    }

    // Priority 3: amount-only evidence can suggest, never confirm.
    const amountMatches = transactions.filter(
      (transaction) => transaction.amountCents === entry.amountCents,
    );

    if (amountMatches.length === 1) {
      const candidate = amountMatches[0];

      if (!candidate) {
        throw new Error("Unexpected missing amount-match candidate");
      }

      return {
        ledgerEntryId: entry.id,
        status: "suggested",
        matchedTo: {
          type: candidate.type,
          id: candidate.id,
        },
        explanation:
          "Amount matches, but no identifying reference confirms the match.",
      };
    }

    if (amountMatches.length > 1) {
      return {
        ledgerEntryId: entry.id,
        status: "suggested",
        explanation:
          "Multiple transactions have the same amount; additional evidence is required.",
      };
    }

    return {
      ledgerEntryId: entry.id,
      status: "unmatched",
      explanation:
        "No PayPal transaction matched by ID, custom_id, or amount.",
    };
  });
}

// Database-backed reconciliation, LLM explanations, nightly cross-check,
// and closing statement will be added in subsequent increments.

/**
 * Reconcile existing ledger entries for one event.
 *
 * PayPal transactions must be supplied by the caller. This function does
 * not fetch live PayPal data or create financial ledger entries.
 *
 * Only reconciliation metadata is updated.
 */

/**
 * Reconcile one event using an explicitly supplied database connection.
 * Exported so integration tests can use an isolated database.
 */
export async function matchLedgerWithDb(
  db: Db,
  eventId: string,
  transactions: PayPalTransactionForRecon[],
): Promise<MatchResult[]> {
  if (!eventId.trim()) {
    throw new Error("eventId must not be empty");
  }

  return db.transaction(async (tx) => {
    const entries = await tx
      .select({
        id: schema.ledgerEntries.id,
        amountCents: schema.ledgerEntries.amountCents,
        businessObjectType: schema.ledgerEntries.businessObjectType,
        businessObjectId: schema.ledgerEntries.businessObjectId,
        paypalObjectType: schema.ledgerEntries.paypalObjectType,
        paypalObjectId: schema.ledgerEntries.paypalObjectId,
      })
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.eventId, eventId));

    const results = matchLedgerEntries(entries, transactions);

    for (const result of results) {
      await tx
        .update(schema.ledgerEntries)
        .set({
          reconStatus: result.status,
          reconNote: result.explanation ?? null,
        })
        .where(eq(schema.ledgerEntries.id, result.ledgerEntryId));
    }

    return results;
  });
}

/**
 * Application entry point: use the shared application database.
 */
export async function matchLedger(
  eventId: string,
  transactions: PayPalTransactionForRecon[],
): Promise<MatchResult[]> {
  const db = await getDb();
  return matchLedgerWithDb(db, eventId, transactions);
}


import { describe, expect, it } from "vitest";
import {
  matchLedgerEntries,
  type LedgerEntryForRecon,
  type MatchResult,
  type PayPalTransactionForRecon,
} from "./index";

const ledger = (
  overrides: Partial<LedgerEntryForRecon> = {},
): LedgerEntryForRecon => ({
  id: "ledger-1",
  amountCents: 2500,
  businessObjectType: "registration",
  businessObjectId: "reg-1",
  paypalObjectType: null,
  paypalObjectId: null,
  ...overrides,
});

const transaction = (
  overrides: Partial<PayPalTransactionForRecon> = {},
): PayPalTransactionForRecon => ({
  id: "capture-1",
  type: "capture",
  amountCents: 2500,
  customId: "reg:reg-1",
  ...overrides,
});

/**
 * Assert that exactly one result exists and safely return it.
 * This satisfies TypeScript's strict indexed-access checks.
 */
function firstResult(results: MatchResult[]): MatchResult {
  expect(results).toHaveLength(1);

  const result = results[0];

  if (!result) {
    throw new Error("Expected one reconciliation result");
  }

  return result;
}

describe("matchLedgerEntries", () => {
  it("matches by PayPal object ID and amount", () => {
    const result = matchLedgerEntries(
      [
        ledger({
          paypalObjectId: "capture-1",
          paypalObjectType: "capture",
        }),
      ],
      [transaction()],
    );

    const match = firstResult(result);

    expect(match.status).toBe("matched");
    expect(match.matchedTo).toEqual({
      type: "capture",
      id: "capture-1",
    });
  });

  it("matches by custom_id when no PayPal object ID is stored", () => {
    const result = matchLedgerEntries([ledger()], [transaction()]);
    const match = firstResult(result);

    expect(match.status).toBe("matched");
    expect(match.explanation).toContain("custom_id");
  });

  it("flags an amount mismatch for an identified transaction", () => {
    const result = matchLedgerEntries(
      [ledger({ paypalObjectId: "capture-1" })],
      [transaction({ amountCents: 2000 })],
    );
    const match = firstResult(result);

    expect(match.status).toBe("flagged");
    expect(match.explanation).toContain("amount");
  });

  it("flags multiple transactions with the same custom_id", () => {
    const result = matchLedgerEntries(
      [ledger()],
      [
        transaction({ id: "capture-1" }),
        transaction({ id: "capture-2" }),
      ],
    );
    const match = firstResult(result);

    expect(match.status).toBe("flagged");
    expect(match.explanation).toContain("duplicate");
  });

  it("suggests an amount-only candidate instead of confirming it", () => {
    const result = matchLedgerEntries(
      [
        ledger({
          businessObjectType: null,
          businessObjectId: null,
        }),
      ],
      [transaction({ customId: null })],
    );
    const match = firstResult(result);

    expect(match.status).toBe("suggested");
    expect(match.matchedTo?.id).toBe("capture-1");
  });

  it("leaves an entry unmatched when no candidate exists", () => {
    const result = matchLedgerEntries(
      [
        ledger({
          amountCents: 9900,
          businessObjectType: null,
          businessObjectId: null,
        }),
      ],
      [
        transaction({
          amountCents: 2500,
          customId: null,
        }),
      ],
    );
    const match = firstResult(result);

    expect(match.status).toBe("unmatched");
    expect(match.matchedTo).toBeUndefined();
  });

  it("rejects non-integer monetary amounts", () => {
    expect(() =>
      matchLedgerEntries(
        [ledger({ amountCents: 25.5 })],
        [transaction()],
      ),
    ).toThrow(/non-negative safe integer in cents/);
  });

  it("rejects negative monetary amounts", () => {
    expect(() =>
      matchLedgerEntries(
        [ledger({ amountCents: -1 })],
        [transaction()],
      ),
    ).toThrow(/non-negative safe integer in cents/);
  });

  it("rejects amounts outside the safe integer range", () => {
    expect(() =>
      matchLedgerEntries(
        [ledger({ amountCents: Number.MAX_SAFE_INTEGER + 1 })],
        [transaction()],
      ),
    ).toThrow(/non-negative safe integer in cents/);
  });
});

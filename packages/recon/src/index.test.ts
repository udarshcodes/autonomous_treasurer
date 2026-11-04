
import { describe, expect, it } from "vitest";
import {
  matchLedgerEntries,
  type LedgerEntryForRecon,
  type MatchResult,
  type PayPalTransactionForRecon,
} from "./index";

function firstResult(results: MatchResult[]): MatchResult {
  expect(results).toHaveLength(1);

  const result = results[0];
  if (!result) {
    throw new Error("Expected one reconciliation result");
  }

  return result;
}

function ledgerEntry(
  overrides: Partial<LedgerEntryForRecon> = {},
): LedgerEntryForRecon {
  return {
    id: "ledger-1",
    amountCents: 2500,
    paypalObjectId: null,
    paypalObjectType: "capture",
    businessObjectType: "registration",
    businessObjectId: "reg-1",
    ...overrides,
  };
}

function transaction(
  overrides: Partial<PayPalTransactionForRecon> = {},
): PayPalTransactionForRecon {
  return {
    id: "capture-1",
    type: "capture",
    amountCents: 2500,
    customId: "reg:reg-1",
    ...overrides,
  };
}

describe("matchLedgerEntries", () => {
  it("matches by PayPal object ID and amount", () => {
    const result = firstResult(
      matchLedgerEntries(
        [ledgerEntry({ paypalObjectId: "capture-1" })],
        [transaction()],
      ),
    );

    expect(result.status).toBe("matched");
    expect(result.matchedTo).toEqual({
      type: "capture",
      id: "capture-1",
    });
  });

  it("matches by custom_id", () => {
    const result = firstResult(
      matchLedgerEntries(
        [ledgerEntry({ paypalObjectId: null })],
        [transaction()],
      ),
    );

    expect(result.status).toBe("matched");
    expect(result.matchedTo?.id).toBe("capture-1");
  });

  it("flags an amount mismatch for a known PayPal ID", () => {
    const result = firstResult(
      matchLedgerEntries(
        [ledgerEntry({ paypalObjectId: "capture-1" })],
        [transaction({ amountCents: 3000 })],
      ),
    );

    expect(result.status).toBe("flagged");
  });

  it("flags multiple transactions with the same custom_id", () => {
    const result = firstResult(
      matchLedgerEntries(
        [ledgerEntry({ paypalObjectId: null })],
        [
          transaction({ id: "capture-1" }),
          transaction({ id: "capture-2" }),
        ],
      ),
    );

    expect(result.status).toBe("flagged");
  });

  it("suggests an amount-only candidate instead of confirming a match", () => {
    const result = firstResult(
      matchLedgerEntries(
        [
          ledgerEntry({
            paypalObjectId: null,
            businessObjectType: null,
            businessObjectId: null,
          }),
        ],
        [transaction({ customId: null })],
      ),
    );

    expect(result.status).toBe("suggested");
    expect(result.matchedTo?.id).toBe("capture-1");
  });

  it("returns unmatched when there is no candidate", () => {
    const result = firstResult(
      matchLedgerEntries(
        [
          ledgerEntry({
            paypalObjectId: null,
            businessObjectType: null,
            businessObjectId: null,
          }),
        ],
        [
          transaction({
            amountCents: 3000,
            customId: null,
          }),
        ],
      ),
    );

    expect(result.status).toBe("unmatched");
    expect(result.matchedTo).toBeUndefined();
  });

  it("rejects fractional cents", () => {
    expect(() =>
      matchLedgerEntries(
        [ledgerEntry({ amountCents: 25.5 })],
        [transaction()],
      ),
    ).toThrow(/safe integer/);
  });

  it("rejects negative amounts", () => {
    expect(() =>
      matchLedgerEntries(
        [ledgerEntry({ amountCents: -1 })],
        [transaction()],
      ),
    ).toThrow(/non-negative/);
  });

  it("rejects unsafe integer amounts", () => {
    expect(() =>
      matchLedgerEntries(
        [ledgerEntry({ amountCents: Number.MAX_SAFE_INTEGER + 1 })],
        [transaction()],
      ),
    ).toThrow(/safe integer/);
  });

  it("does not match one PayPal transaction to two ledger entries", () => {
    const results = matchLedgerEntries(
      [
        ledgerEntry({
          id: "ledger-1",
          paypalObjectId: null,
          businessObjectId: "reg-1",
        }),
        ledgerEntry({
          id: "ledger-2",
          paypalObjectId: null,
          businessObjectId: "reg-1",
        }),
      ],
      [transaction()],
    );

    const confirmedMatches = results.filter(
      (result) =>
        result.status === "matched" &&
        result.matchedTo?.id === "capture-1",
    );

    expect(confirmedMatches).toHaveLength(1);
  });

  it("does not fall back to an unrelated transaction when a known PayPal ID is missing", () => {
    const result = firstResult(
      matchLedgerEntries(
        [
          ledgerEntry({
            paypalObjectId: "capture-expected",
            businessObjectId: "reg-3",
          }),
        ],
        [
          transaction({
            id: "capture-unrelated",
            customId: "reg:another-registration",
          }),
        ],
      ),
    );

    expect(result.status).not.toBe("matched");
    expect(result.matchedTo?.id).not.toBe("capture-unrelated");
  });
});

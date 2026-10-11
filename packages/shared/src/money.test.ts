import { describe, expect, it } from "vitest";
import { centsToPayPalValue, formatCents, parseAmountToCents, payPalValueToCents, splitCents } from "./money";

describe("money", () => {
  it("parses common amount spellings", () => {
    expect(parseAmountToCents("$1,234.5")).toBe(123450);
    expect(parseAmountToCents("500")).toBe(50000);
    expect(parseAmountToCents("USD 12.34")).toBe(1234);
    expect(parseAmountToCents("12.345")).toBeNull();
    expect(parseAmountToCents("five hundred")).toBeNull();
  });

  it("round-trips PayPal values", () => {
    expect(centsToPayPalValue(5)).toBe("0.05");
    expect(centsToPayPalValue(123456)).toBe("1234.56");
    expect(payPalValueToCents("1234.56")).toBe(123456);
  });

  it("formats for display", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
  });

  it("splits without losing a cent", () => {
    const parts = splitCents(50000, 3);
    expect(parts).toEqual([16667, 16667, 16666]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(50000);
  });
});

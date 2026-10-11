import { describe, expect, it } from "vitest";
import { checkDraft, fillSlots, ordinal } from "./slots";

const slots = { amount: "$42.00", budget_line: "Catering", pay_link: "https://x.test/p/1" };

describe("slot drafts", () => {
  it("accepts prose that uses only slots", () => {
    expect(checkDraft("{amount} for {budget_line}", slots, ["amount"]).ok).toBe(true);
  });

  it("rejects digits, currency symbols and percentages typed by the model", () => {
    expect(checkDraft("$42 for {budget_line}", slots).ok).toBe(false);
    expect(checkDraft("{amount}, 90% used", slots).ok).toBe(false);
    expect(checkDraft("leaves 3 days", slots).ok).toBe(false);
  });

  it("rejects links, unknown slots and missing required slots", () => {
    expect(checkDraft("pay at https://evil.test", slots).ok).toBe(false);
    expect(checkDraft("{amount} to {iban}", slots).problems).toContain("unknown slot {iban}");
    expect(checkDraft("hello", slots, ["pay_link"]).problems).toContain("missing required slot {pay_link}");
  });

  it("fills slots with code values", () => {
    expect(fillSlots("{amount} on {budget_line}", slots)).toBe("$42.00 on Catering");
    expect(() => fillSlots("{nope}", slots)).toThrow();
  });

  it("formats ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
  });
});

/**
 * All amounts are integer minor units (cents). Never use floats for money.
 * Convert at the edges only: parsing user/PayPal input, and formatting for display.
 */

export type Cents = number;

export const CURRENCY = "USD" as const;
export type Currency = typeof CURRENCY;

export function assertCents(value: number): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Amount must be an integer number of cents, got ${value}`);
  }
  return value;
}

/** Parse "1,234.5", "$1234.50", "1234" into cents. Returns null when the text is not a plain amount. */
export function parseAmountToCents(text: string): Cents | null {
  const cleaned = text.trim().replace(/^(usd|us\$|\$)\s*/i, "").replace(/\s*(usd)$/i, "").replace(/,/g, "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "0").padEnd(2, "0"));
  return assertCents(whole * 100 + fraction);
}

/** PayPal REST wants decimal strings: 12345 -> "123.45". */
export function centsToPayPalValue(cents: Cents): string {
  assertCents(cents);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function payPalValueToCents(value: string): Cents {
  const cents = parseAmountToCents(value.replace(/^-/, ""));
  if (cents === null) throw new Error(`Invalid PayPal amount: ${value}`);
  return value.startsWith("-") ? -cents : cents;
}

/** Display formatting: 12345 -> "$123.45". */
export function formatCents(cents: Cents, currency: Currency = CURRENCY): string {
  const symbol = currency === "USD" ? "$" : `${currency} `;
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}${symbol}${whole}.${String(abs % 100).padStart(2, "0")}`;
}

/** Split an amount into n parts that sum exactly; earlier parts absorb the remainder. */
export function splitCents(total: Cents, parts: number): Cents[] {
  if (parts < 1 || !Number.isInteger(parts)) throw new Error("parts must be a positive integer");
  const base = Math.floor(total / parts);
  const remainder = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

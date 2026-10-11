/**
 * Prize-list parser — owner: AI 5 (C5).
 *
 * Deterministic first: a CSV/TSV with recognisable headers is parsed in code.
 * Anything else (pasted Slack message, judges' notes) goes to the LLM as untrusted
 * data and comes back as structured rows. Amounts are always parsed by code from the
 * text the model copied, never taken as numbers from the model.
 */
import { z } from "zod";
import { UNTRUSTED_NOTICE, untrusted, type LlmClient } from "@treasurer/llm";
import { parseAmountToCents } from "@treasurer/shared";
import { parseDelimited } from "./csv";

export interface PrizeEntry {
  /** 1-based row in the source, for pointing the user at problems. */
  line: number;
  place: number | null;
  /** e.g. "Best Use of PayPal" for category prizes. */
  category: string | null;
  teamName: string;
  amountText: string;
  amountCents: number | null;
  recipientEmails: string[];
}

export interface ParsedPrizeList {
  entries: PrizeEntry[];
  source: "csv" | "llm";
  warnings: string[];
}

const HEADER_ALIASES: Record<keyof Omit<PrizeEntry, "line" | "amountCents">, string[]> = {
  place: ["place", "rank", "position", "pos", "#"],
  category: ["category", "prize", "award", "track"],
  teamName: ["team", "team name", "teamname", "winner", "winners", "name"],
  amountText: ["amount", "prize amount", "value", "usd", "amount (usd)", "payout"],
  recipientEmails: ["email", "emails", "paypal", "paypal email", "recipient", "recipients", "receiver"],
};

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function normaliseHeader(h: string): string {
  return h.toLowerCase().replace(/[_\s]+/g, " ").trim();
}

export function parsePlace(text: string): number | null {
  const m = /^(\d+)(st|nd|rd|th)?(\s*place)?$/i.exec(text.trim());
  if (m) return Number(m[1]);
  const words: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, winner: 1, "runner up": 2, "runner-up": 2 };
  return words[text.trim().toLowerCase().replace(/\s*place$/, "")] ?? null;
}

/** Try to read the list as a table with headers. Returns null if it does not look like one. */
export function parsePrizeTable(text: string): ParsedPrizeList | null {
  const rows = parseDelimited(text);
  if (rows.length < 2 || rows[0]!.length < 2) return null;

  const header = rows[0]!.map(normaliseHeader);
  const col: Partial<Record<keyof typeof HEADER_ALIASES, number>> = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES) as [keyof typeof HEADER_ALIASES, string[]][]) {
    const idx = header.findIndex((h) => aliases.includes(h));
    if (idx >= 0 && !Object.values(col).includes(idx)) col[key] = idx;
  }
  if (col.teamName === undefined || col.amountText === undefined) return null;

  const warnings: string[] = [];
  const entries: PrizeEntry[] = rows.slice(1).map((row, i) => {
    const cell = (k: keyof typeof HEADER_ALIASES) => (col[k] === undefined ? "" : (row[col[k]!] ?? ""));
    const amountText = cell("amountText");
    const placeText = cell("place");
    const place = placeText ? parsePlace(placeText) : null;
    if (placeText && place === null) warnings.push(`Row ${i + 2}: could not read place "${placeText}"`);
    return {
      line: i + 2,
      place,
      category: cell("category") || null,
      teamName: cell("teamName"),
      amountText,
      amountCents: parseAmountToCents(amountText),
      recipientEmails: [...cell("recipientEmails").matchAll(EMAIL)].map((m) => m[0].toLowerCase()),
    };
  });
  return { entries, source: "csv", warnings };
}

const LlmPrizeRows = z.object({
  rows: z.array(
    z.object({
      place: z.int().nullable().describe("Finishing place as an integer, or null for category prizes"),
      category: z.string().nullable(),
      teamName: z.string(),
      amountText: z.string().describe("The prize amount exactly as written in the source, e.g. '$500' or '250 USD'"),
      recipientEmails: z.array(z.string()),
    }),
  ),
  unreadable: z.array(z.string()).describe("Lines that look like winners but could not be read"),
});

const SYSTEM = `You read hackathon prize-winner lists and return them as rows.
${UNTRUSTED_NOTICE}
Copy team names, amounts and emails exactly as written. Do not compute, convert or total amounts. Do not add winners that are not in the text. If a line is ambiguous, put it in "unreadable" instead of guessing.`;

export async function parsePrizeList(text: string, llm?: LlmClient): Promise<ParsedPrizeList> {
  const table = parsePrizeTable(text);
  if (table) return table;

  if (!llm) {
    return {
      entries: [],
      source: "llm",
      warnings: ["Not a table with Team and Amount columns, and no LLM is configured to read free text."],
    };
  }

  const out = await llm.object({
    label: "comms.prize_list_parser",
    tier: "main",
    effort: "medium",
    maxTokens: 8000,
    schema: LlmPrizeRows,
    system: SYSTEM,
    content: untrusted("prize_list_upload", text),
  });

  const sourceLower = text.toLowerCase();
  const warnings = out.unreadable.map((u) => `Could not read: ${u}`);
  const entries: PrizeEntry[] = out.rows.map((r, i) => {
    // The model must copy, not invent: every amount and email must appear in the source text.
    if (!sourceLower.includes(r.amountText.toLowerCase())) {
      warnings.push(`Row ${i + 1}: amount "${r.amountText}" does not appear in the uploaded text`);
    }
    const emails = r.recipientEmails.map((e) => e.toLowerCase()).filter((e) => {
      const present = sourceLower.includes(e);
      if (!present) warnings.push(`Row ${i + 1}: email ${e} does not appear in the uploaded text, ignored`);
      return present;
    });
    const amountVerbatim = sourceLower.includes(r.amountText.toLowerCase());
    return {
      line: i + 1,
      place: r.place,
      category: r.category,
      teamName: r.teamName.trim(),
      amountText: r.amountText,
      amountCents: amountVerbatim ? parseAmountToCents(r.amountText) : null,
      recipientEmails: emails,
    };
  });
  return { entries, source: "llm", warnings };
}

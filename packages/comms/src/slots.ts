/**
 * "Numbers come from code" (AI design rule 1).
 *
 * The model writes prose containing {slot} placeholders. It never types a digit,
 * amount, percentage, date or link itself. Code checks the draft, then fills each
 * slot with a value the backend computed.
 */

export type Slots = Record<string, string>;

const SLOT = /\{([a-z][a-z0-9_]*)\}/g;
/** Characters that mean the model wrote a figure itself. */
const FORBIDDEN = /[0-9$€£₹%]/;

export interface DraftCheck {
  ok: boolean;
  problems: string[];
}

/** Validate a model-written template against the allowed slots. */
export function checkDraft(template: string, allowed: Slots, required: string[] = []): DraftCheck {
  const problems: string[] = [];
  const used = new Set<string>();
  for (const [, name] of template.matchAll(SLOT)) {
    if (!name) continue;
    used.add(name);
    if (!(name in allowed)) problems.push(`unknown slot {${name}}`);
  }
  const withoutSlots = template.replace(SLOT, "");
  const bad = FORBIDDEN.exec(withoutSlots);
  if (bad) problems.push(`model wrote a figure directly ("${bad[0]}"); figures must use slots`);
  if (/https?:\/\/|www\./i.test(withoutSlots)) problems.push("model wrote a link directly; links must use slots");
  if (/[{}]/.test(withoutSlots)) problems.push("malformed slot braces");
  for (const name of required) if (!used.has(name)) problems.push(`missing required slot {${name}}`);
  return { ok: problems.length === 0, problems };
}

/** Replace {slot} tokens with code-computed values. Throws on unknown slots. */
export function fillSlots(template: string, slots: Slots): string {
  return template.replace(SLOT, (_, name: string) => {
    const value = slots[name];
    if (value === undefined) throw new Error(`No value for slot {${name}}`);
    return value;
  });
}

/** Describe the available slots to the model without revealing values it might copy. */
export function describeSlots(descriptions: Record<string, string>): string {
  return Object.entries(descriptions)
    .map(([name, what]) => `- {${name}}: ${what}`)
    .join("\n");
}

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

export function listToText(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

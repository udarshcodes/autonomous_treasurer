import type { z } from "zod";
import type { LlmClient, ObjectRequest } from "@treasurer/llm";
import { checkDraft, fillSlots, type Slots } from "./slots";

/**
 * Ask the model for slot templates, validate every field, retry with the problems
 * listed, and fall back to a deterministic template if the model still fails.
 * The returned text is always fully filled by code.
 */
export interface DraftResult<K extends string> {
  text: Record<K, string>;
  source: "llm" | "template";
  /** Why the LLM draft was rejected, if it was. Logged to the audit trail. */
  rejected: string[];
}

export async function draftWithSlots<K extends string, S extends z.ZodType<Record<K, string>>>(opts: {
  llm: LlmClient | undefined;
  request: Omit<ObjectRequest<S>, "retries">;
  slots: Slots;
  required: Partial<Record<K, string[]>>;
  fallback: Record<K, string>;
  maxLength?: Partial<Record<K, number>>;
  attempts?: number;
}): Promise<DraftResult<K>> {
  const rejected: string[] = [];
  const fields = Object.keys(opts.fallback) as K[];

  if (opts.llm) {
    let content = opts.request.content;
    for (let attempt = 1; attempt <= (opts.attempts ?? 2); attempt++) {
      let draft: Record<K, string>;
      try {
        draft = (await opts.llm.object({ ...opts.request, content, retries: 1 })) as Record<K, string>;
      } catch (err) {
        rejected.push(`attempt ${attempt}: ${(err as Error).message}`);
        break;
      }
      const problems: string[] = [];
      for (const field of fields) {
        const check = checkDraft(draft[field] ?? "", opts.slots, opts.required[field] ?? []);
        problems.push(...check.problems.map((p) => `${field}: ${p}`));
        const max = opts.maxLength?.[field];
        if (max && fillSafe(draft[field] ?? "", opts.slots).length > max) problems.push(`${field}: longer than ${max} chars`);
      }
      if (problems.length === 0) {
        const text = Object.fromEntries(fields.map((f) => [f, fillSlots(draft[f], opts.slots)])) as Record<K, string>;
        return { text, source: "llm", rejected };
      }
      rejected.push(`attempt ${attempt}: ${problems.join("; ")}`);
      if (typeof content === "string") {
        content = `${content}\n\nYour previous draft was rejected for these reasons:\n- ${problems.join("\n- ")}\nFix them.`;
      }
    }
  }

  const text = Object.fromEntries(fields.map((f) => [f, fillSlots(opts.fallback[f], opts.slots)])) as Record<K, string>;
  return { text, source: "template", rejected };
}

function fillSafe(template: string, slots: Slots): string {
  try {
    return fillSlots(template, slots);
  } catch {
    return template;
  }
}

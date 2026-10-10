/**
 * Shared LLM client — owner: AI 1.
 *
 * One provider (Anthropic), two tiers:
 *   main: planning, receipt vision, reconciliation explanations  (LLM_MODEL,      default claude-opus-5-5)
 *   fast: classification, nudge and explainer drafting            (LLM_MODEL_FAST, default claude-haiku-5-5)
 *
 * Every call returns schema-validated structured output. Callers never parse free text.
 * HTTP-level retries (429/5xx/network) are handled by the SDK; this layer retries
 * schema failures and logs every call.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

export type ModelTier = "main" | "fast";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type LlmContent = string | Anthropic.Beta.BetaContentBlockParam[];

export interface ObjectRequest<S extends z.ZodType> {
  /** Short name for logs and the audit trail, e.g. "comms.approval_explainer". */
  label: string;
  schema: S;
  system: string;
  content: LlmContent;
  tier?: ModelTier;
  effort?: Effort;
  maxTokens?: number;
  /** Extra attempts when output fails schema validation. Default 2. */
  retries?: number;
}

export interface LlmClient {
  object<S extends z.ZodType>(req: ObjectRequest<S>): Promise<z.infer<S>>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly label: string,
    readonly reason: "refusal" | "invalid_output" | "max_tokens" | "unavailable",
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export interface LlmLogEntry {
  label: string;
  model: string;
  attempt: number;
  ok: boolean;
  ms: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
}

export interface AnthropicLlmOptions {
  client?: Anthropic;
  mainModel?: string;
  fastModel?: string;
  log?: (entry: LlmLogEntry) => void;
}

const defaultLog = (entry: LlmLogEntry) => {
  if (process.env.LLM_LOG !== "off") console.log(`[llm] ${JSON.stringify(entry)}`);
};

/** Haiku has no server-side refusal fallback; the other current models do. */
const supportsServerFallback = (model: string) => !model.includes("haiku");

export function createAnthropicLlm(opts: AnthropicLlmOptions = {}): LlmClient {
  const client = opts.client ?? new Anthropic();
  const models: Record<ModelTier, string> = {
    main: opts.mainModel ?? process.env.LLM_MODEL ?? "claude-opus-5-5",
    fast: opts.fastModel ?? process.env.LLM_MODEL_FAST ?? "claude-haiku-5-5",
  };
  const log = opts.log ?? defaultLog;

  return {
    async object<S extends z.ZodType>(req: ObjectRequest<S>): Promise<z.infer<S>> {
      const model = models[req.tier ?? "main"];
      const attempts = 1 + (req.retries ?? 2);
      let lastError: LlmError | undefined;

      for (let attempt = 1; attempt <= attempts; attempt++) {
        const started = Date.now();
        try {
          const fallback = supportsServerFallback(model)
            ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
            : {};
          const response = await client.beta.messages.parse({
            model,
            max_tokens: req.maxTokens ?? 16000,
            system: req.system,
            messages: [{ role: "user", content: req.content }],
            output_config: { effort: req.effort ?? "medium", format: betaZodOutputFormat(req.schema) },
            ...fallback,
          });

          const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
          if (response.stop_reason === "refusal") {
            log({ label: req.label, model, attempt, ok: false, ms: Date.now() - started, ...usage, error: "refusal" });
            throw new LlmError("Model declined the request", req.label, "refusal");
          }
          if (response.stop_reason === "max_tokens") {
            lastError = new LlmError("Output truncated at max_tokens", req.label, "max_tokens");
          } else {
            const checked = req.schema.safeParse(response.parsed_output);
            if (checked.success) {
              log({ label: req.label, model, attempt, ok: true, ms: Date.now() - started, ...usage });
              return checked.data;
            }
            lastError = new LlmError(`Output failed schema: ${checked.error.message}`, req.label, "invalid_output");
          }
          log({ label: req.label, model, attempt, ok: false, ms: Date.now() - started, ...usage, error: lastError.message });
        } catch (err) {
          if (err instanceof LlmError) throw err; // refusals are not retried
          if (err instanceof Anthropic.APIError) {
            log({ label: req.label, model, attempt, ok: false, ms: Date.now() - started, error: `${err.status} ${err.message}` });
            throw new LlmError(`LLM API error: ${err.message}`, req.label, "unavailable");
          }
          throw err;
        }
      }
      throw lastError ?? new LlmError("LLM call failed", req.label, "invalid_output");
    },
  };
}

let shared: LlmClient | undefined;

/** Process-wide client. Returns undefined when no credentials are configured, so callers can fall back. */
export function getLlm(): LlmClient | undefined {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return undefined;
  shared ??= createAnthropicLlm();
  return shared;
}

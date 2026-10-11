/**
 * PayPal REST client — owner: Dev 1.
 *
 * Rules:
 *  - Every write sends PayPal-Request-Id (idempotency). Callers pass a deterministic key.
 *  - Only the policy engine imports the money-moving wrappers (payouts, refunds).
 *    The agent process gets read-only access via the Agent Toolkit.
 */

export type PayPalEnv = "sandbox" | "live";

export interface PayPalConfig {
  env: PayPalEnv;
  clientId: string;
  clientSecret: string;
}

export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly debugId: string | undefined,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "PayPalError";
  }
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): PayPalConfig {
  const clientId = env.PAYPAL_CLIENT_ID;
  const clientSecret = env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set");
  }
  return { env: env.PAYPAL_ENV === "live" ? "live" : "sandbox", clientId, clientSecret };
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Required for writes. Sent as PayPal-Request-Id. */
  requestId?: string;
  query?: Record<string, string | number | undefined>;
}

export class PayPalClient {
  private token: { value: string; expiresAt: number } | undefined;

  constructor(readonly config: PayPalConfig) {}

  get baseUrl(): string {
    return this.config.env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");
    const res = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!res.ok || !json.access_token) {
      throw new PayPalError("PayPal OAuth failed", res.status, res.headers.get("paypal-debug-id") ?? undefined, json);
    }
    this.token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 0) * 1000 };
    return this.token.value;
  }

  async request<T>(path: string, opts: RequestOptions = {}): Promise<{ data: T; debugId?: string }> {
    const method = opts.method ?? "GET";
    if (method !== "GET" && !opts.requestId) {
      throw new Error(`PayPal ${method} ${path} requires a requestId for idempotency`);
    }
    const url = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));

    const headers: Record<string, string> = {
      Authorization: `Bearer ${await this.accessToken()}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };
    if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;

    const res = await fetch(url, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const debugId = res.headers.get("paypal-debug-id") ?? undefined;
    const text = await res.text();
    const data = text ? (JSON.parse(text) as T) : (undefined as T);
    if (!res.ok) {
      const message = (data as { message?: string } | undefined)?.message ?? `PayPal ${method} ${path} failed`;
      throw new PayPalError(message, res.status, debugId, data);
    }
    return { data, debugId };
  }
}

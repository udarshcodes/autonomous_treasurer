export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store", ...init });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status);
  return body as T;
}

export function postJson<T>(path: string, data: unknown): Promise<T> {
  return api<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
}

export function formatCents(cents: number): string {
  return `$${Math.floor(cents / 100).toLocaleString("en-US")}.${String(cents % 100).padStart(2, "0")}`;
}

export interface PublicEvent {
  slug: string;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  currency: string;
  feeCents: number;
}

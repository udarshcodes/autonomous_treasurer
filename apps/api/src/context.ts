import { getDb, type Db } from "@treasurer/db";
import { getLlm, type LlmClient } from "@treasurer/llm";
import { configFromEnv, PayPalClient } from "@treasurer/paypal";

/** Process-wide dependencies. Routes get them from here so tests can swap them. */
export interface Deps {
  db: Db;
  llm: LlmClient | undefined;
  /** Undefined when PayPal credentials are not configured (local dev without sandbox). */
  paypal: PayPalClient | undefined;
  publicAppUrl: string;
  uploadDir: string;
}

let deps: Deps | undefined;

export async function getDeps(): Promise<Deps> {
  if (deps) return deps;
  let paypal: PayPalClient | undefined;
  try {
    paypal = new PayPalClient(configFromEnv());
  } catch {
    console.warn("[api] PayPal credentials not set; checkout endpoints will return 503");
  }
  deps = {
    db: await getDb(),
    llm: getLlm(),
    paypal,
    publicAppUrl: process.env.PUBLIC_APP_URL ?? "http://localhost:3000",
    uploadDir: process.env.UPLOAD_DIR ?? ".data/uploads",
  };
  return deps;
}

export function setDeps(d: Deps) {
  deps = d;
}

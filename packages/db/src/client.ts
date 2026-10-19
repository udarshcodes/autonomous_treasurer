
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/** Common type for both drivers (postgres-js and PGlite). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const packageDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(packageDirectory, "../../..");

/**
 * DATABASE_URL set   -> real Postgres.
 * DATABASE_URL empty -> embedded PGlite at the repository-level .data/pglite.
 *
 * Resolve the path independently of process.cwd() so workspace scripts and
 * root-level scripts always connect to the same local database.
 */
async function createDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;

  if (url) {
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { default: postgres } = await import("postgres");

    return drizzle(postgres(url, { max: 10 }), {
      schema,
    }) as unknown as Db;
  }

  const { drizzle } = await import("drizzle-orm/pglite");
  const { PGlite } = await import("@electric-sql/pglite");

  const configuredDir = process.env.PGLITE_DIR;

const dir =
  configuredDir === "memory://"
    ? "memory://"
    : configuredDir
      ? path.resolve(repositoryRoot, configuredDir)
      : path.join(repositoryRoot, ".data", "pglite");

if (dir !== "memory://") {
  mkdirSync(dir, { recursive: true });
}

  return drizzle(new PGlite(dir), { schema }) as unknown as Db;
}

let dbPromise: Promise<Db> | undefined;

export function getDb(): Promise<Db> {
  dbPromise ??= createDb();
  return dbPromise;
}

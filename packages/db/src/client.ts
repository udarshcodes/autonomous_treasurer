import { mkdirSync } from "node:fs";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/** Common type for both drivers (postgres-js and PGlite). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * DATABASE_URL set   -> real Postgres (Render, docker-compose).
 * DATABASE_URL empty -> embedded PGlite in ./.data/pglite, so anyone can run the app
 *                       from a clean clone without installing Postgres.
 */
async function createDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { default: postgres } = await import("postgres");
    return drizzle(postgres(url, { max: 10 }), { schema }) as unknown as Db;
  }
  const { drizzle } = await import("drizzle-orm/pglite");
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = process.env.PGLITE_DIR ?? ".data/pglite";
  if (dir !== "memory://") mkdirSync(dir, { recursive: true });
  return drizzle(new PGlite(dir), { schema }) as unknown as Db;
}

let dbPromise: Promise<Db> | undefined;

export function getDb(): Promise<Db> {
  dbPromise ??= createDb();
  return dbPromise;
}

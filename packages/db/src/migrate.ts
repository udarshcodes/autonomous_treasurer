import { fileURLToPath } from "node:url";
import path from "node:path";
import { getDb } from "./client";

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const db = await getDb();
if (process.env.DATABASE_URL) {
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  await migrate(db as never, { migrationsFolder });
} else {
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  await migrate(db as never, { migrationsFolder });
}
console.log("migrations applied");
process.exit(0);

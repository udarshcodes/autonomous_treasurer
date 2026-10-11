import { newId } from "@treasurer/shared";
import { schema, type Db } from "@treasurer/db";

/** Append-only audit log. Owner: AI 3 (schema of actions) / Dev 1 (storage). */
export async function audit(
  db: Db,
  entry: {
    eventId?: string;
    actor: string;
    action: string;
    subjectType?: string;
    subjectId?: string;
    data?: unknown;
    paypalRequestId?: string;
    paypalDebugId?: string;
  },
) {
  await db.insert(schema.auditEvents).values({ id: newId("aud"), ...entry });
}

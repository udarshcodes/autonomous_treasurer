import type { TeamRecord } from "@treasurer/comms";
import { eq, inArray, schema, type Db } from "@treasurer/db";

/** Load registrations + members into the shape the comms module works on. */
export async function loadTeams(db: Db, eventId: string): Promise<TeamRecord[]> {
  const regs = await db.select().from(schema.registrations).where(eq(schema.registrations.eventId, eventId));
  if (regs.length === 0) return [];
  const mems = await db
    .select()
    .from(schema.members)
    .where(inArray(schema.members.registrationId, regs.map((r) => r.id)));
  return regs.map((r) => ({
    id: r.id,
    teamName: r.teamName,
    status: r.status,
    track: r.track,
    members: mems
      .filter((m) => m.registrationId === r.id)
      .map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        isLead: m.isLead,
        shareCents: m.shareCents,
        paidCents: m.paidCents,
        payToken: m.payToken,
        nudgesSent: m.nudgesSent,
        lastNudgedAt: m.lastNudgedAt,
      })),
  }));
}

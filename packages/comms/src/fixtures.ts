import type { MemberRecord, TeamRecord } from "./teams";

export function member(name: string, opts: Partial<MemberRecord> = {}): MemberRecord {
  const slug = name.toLowerCase().replace(/\s+/g, ".");
  const email = `${slug}@example.edu`;
  return {
    id: `mem_${slug}`,
    name,
    email,
    isLead: false,
    shareCents: 2500,
    paidCents: 2500,
    payToken: `tok_${slug}`,
    nudgesSent: 0,
    lastNudgedAt: null,
    ...opts,
  };
}

export function team(id: string, teamName: string, members: MemberRecord[], status: TeamRecord["status"] = "paid"): TeamRecord {
  if (members[0]) members[0].isLead = true;
  return { id, teamName, status, members };
}

export function demoTeams(): TeamRecord[] {
  return [
    team("reg_1", "Null Pointers", [member("Asha Rao"), member("Ben Ortiz"), member("Chen Wei")]),
    team("reg_2", "Byte Me", [member("Dana Kim"), member("Eli Moss")]),
    team("reg_3", "Stack Smashers", [member("Farah Ali"), member("Gus Hale"), member("Hana Sato")]),
    team("reg_4", "Merge Conflict", [member("Ivan Pope"), member("Jo Park", { paidCents: 0 })], "partially_paid"),
  ];
}

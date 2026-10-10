import { describe, expect, it } from "vitest";
import { createFakeLlm } from "@treasurer/llm";
import { member, team } from "./fixtures";
import { draftMemberNudge, draftSponsorReminder, memberTone, sponsorTone } from "./nudges";
import { findNudgeTargets, summarizeTeam } from "./teams";

const now = new Date("2026-10-15T12:00:00Z");

describe("findNudgeTargets", () => {
  const teams = [
    team("t1", "Null Pointers", [member("Asha Rao"), member("Ben Ortiz", { paidCents: 0 }), member("Chen Wei", { paidCents: 0 })], "partially_paid"),
    team("t2", "Byte Me", [member("Dana Kim", { paidCents: 0 }), member("Eli Moss", { paidCents: 0 })], "pending"),
    team("t3", "Paid Up", [member("Fay Lu")]),
    team(
      "t4",
      "Cooldown",
      [member("Gil Ng"), member("Hal Oz", { paidCents: 0, nudgesSent: 1, lastNudgedAt: new Date("2026-10-15T06:00:00Z") })],
      "partially_paid",
    ),
    team("t5", "Maxed", [member("Ida Re"), member("Jon Su", { paidCents: 0, nudgesSent: 3 })], "partially_paid"),
  ];

  it("flags partial teams and targets only unpaid members", () => {
    const scan = findNudgeTargets(teams, now);
    expect(scan.partialTeams.map((t) => t.teamName)).toEqual(["Null Pointers", "Cooldown", "Maxed"]);
    expect(scan.unpaidTeams.map((t) => t.teamName)).toEqual(["Byte Me"]);
    expect(scan.targets.map((t) => t.member.name)).toEqual(["Ben Ortiz", "Chen Wei", "Dana Kim"]);
    expect(scan.skipped).toEqual([
      { memberId: teams[3]!.members[1]!.id, reason: "cooldown" },
      { memberId: teams[4]!.members[1]!.id, reason: "max_nudges" },
    ]);
  });

  it("summarises outstanding amounts", () => {
    const s = summarizeTeam(teams[0]!);
    expect(s).toMatchObject({ state: "partial", paidCount: 1, teamSize: 3, outstandingCents: 5000 });
  });
});

describe("draftMemberNudge", () => {
  const t = team("t1", "Null Pointers", [member("Asha Rao"), member("Ben Ortiz", { paidCents: 0 })], "partially_paid");
  const target = { team: summarizeTeam(t), member: t.members[1]!, reason: "partial_team" as const };

  it("escalates tone from history", () => {
    expect([0, 1, 2, 5].map(memberTone)).toEqual(["friendly", "reminder", "final", "final"]);
    expect(sponsorTone(-3, 0)).toBe("friendly");
    expect(sponsorTone(3, 1)).toBe("reminder");
    expect(sponsorTone(20, 1)).toBe("final");
  });

  it("fills the model's draft with code values and requires the pay link", async () => {
    const llm = createFakeLlm(() => ({
      subject: "{team_name} is almost there",
      body: "Hey {first_name}, {paid_count} of {team_size} teammates have paid. Your share is {amount_due}: {pay_link}",
    }));
    const msg = await draftMemberNudge({ target, eventName: "HackFest", payLink: "https://app.test/e/hf/pay/tok" }, llm);
    expect(msg.source).toBe("llm");
    expect(msg.to).toBe("ben.ortiz@example.edu");
    expect(msg.body).toBe("Hey Ben, 1 of 2 teammates have paid. Your share is $25.00: https://app.test/e/hf/pay/tok");
  });

  it("falls back when the model drops the link", async () => {
    const llm = createFakeLlm(() => ({ subject: "Pay up", body: "Hi {first_name}, please pay {amount_due}." }));
    const msg = await draftMemberNudge({ target, eventName: "HackFest", payLink: "https://app.test/p" }, llm);
    expect(msg.source).toBe("template");
    expect(msg.body).toContain("https://app.test/p");
    expect(msg.body).toContain("1 of 2 people on Null Pointers have paid");
  });
});

describe("draftSponsorReminder", () => {
  it("drafts an overdue reminder without an LLM", async () => {
    const msg = await draftSponsorReminder({
      sponsorName: "Acme Cloud",
      contactName: "Maria Lopez",
      eventName: "HackFest",
      invoiceNumber: "HF-0003",
      amountCents: 250000,
      dueDate: "10 October",
      daysOverdue: 5,
      remindersSent: 1,
      deliverables: ["logo on the website", "a booth"],
    });
    expect(msg.tone).toBe("reminder");
    expect(msg.subject).toBe("Invoice HF-0003 for HackFest is past due");
    expect(msg.note).toContain("$2,500.00 was due on 10 October and is now 5 days past due");
    expect(msg.note).toContain("logo on the website, a booth");
  });
});

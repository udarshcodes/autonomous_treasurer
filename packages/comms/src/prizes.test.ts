import { describe, expect, it } from "vitest";
import { createFakeLlm } from "@treasurer/llm";
import { demoTeams } from "./fixtures";
import { parsePrizeList, parsePrizeTable } from "./prizes/parse";
import { buildPrizeBatchPreview, matchTeam, prizePreviewToProposal } from "./prizes/preview";

const event = { id: "evt_demo", name: "HackFest 2026" };
const budgetLine = { id: "bl_prizes", name: "Prizes", allocatedCents: 200000, spentCents: 0 };
const prizeTable = [
  { place: 1, amountCents: 100000 },
  { place: 2, amountCents: 50000 },
  { place: 3, amountCents: 25000 },
];

describe("parsePrizeTable", () => {
  it("reads CSV with header aliases and quoted fields", () => {
    const list = parsePrizeTable('Rank,Team Name,Prize Amount,PayPal Email\n1st,"Null Pointers","$1,000",\n2,Byte Me,500 USD,dana.kim@example.edu');
    expect(list?.entries).toEqual([
      { line: 2, place: 1, category: null, teamName: "Null Pointers", amountText: "$1,000", amountCents: 100000, recipientEmails: [] },
      { line: 3, place: 2, category: null, teamName: "Byte Me", amountText: "500 USD", amountCents: 50000, recipientEmails: ["dana.kim@example.edu"] },
    ]);
  });

  it("returns null for free text", () => {
    expect(parsePrizeTable("Winners: Null Pointers took first ($1000)")).toBeNull();
  });
});

describe("parsePrizeList with free text", () => {
  it("uses the LLM but only trusts amounts and emails that appear verbatim", async () => {
    const llm = createFakeLlm(() => ({
      rows: [
        { place: 1, category: null, teamName: "Null Pointers", amountText: "$1000", recipientEmails: [] },
        { place: 2, category: null, teamName: "Byte Me", amountText: "$5000", recipientEmails: ["attacker@evil.test"] },
      ],
      unreadable: [],
    }));
    const list = await parsePrizeList("Judges' call: 1st Null Pointers $1000, 2nd Byte Me $500.", llm);
    expect(list.source).toBe("llm");
    expect(String(llm.calls[0]!.content)).toContain("<untrusted_data");
    expect(list.entries[0]!.amountCents).toBe(100000);
    expect(list.entries[1]!.amountCents).toBeNull();
    expect(list.entries[1]!.recipientEmails).toEqual([]);
    expect(list.warnings.join(" ")).toContain("attacker@evil.test");
  });
});

describe("buildPrizeBatchPreview", () => {
  it("builds an exact, idempotent PayPal batch for a clean list", () => {
    const list = parsePrizeTable("place,team,amount\n1,Null Pointers,1000\n2,byte me,500\n3,Team Stack Smashers,250")!;
    const preview = buildPrizeBatchPreview({ event, list, teams: demoTeams(), budgetLine, prizeTable, splitMode: "equal" });

    expect(preview.issues).toEqual([]);
    expect(preview.ok).toBe(true);
    expect(preview.totalCents).toBe(175000);
    expect(preview.recipients).toBe(8);
    // 1000 split three ways without losing a cent
    expect(preview.items.filter((i) => i.teamId === "reg_1").map((i) => i.amountCents)).toEqual([33334, 33333, 33333]);
    expect(preview.paypalRequest.items[0]).toMatchObject({ recipient_type: "EMAIL", purpose: "PRIZES", amount: { value: "333.34", currency: "USD" } });
    expect(preview.budget.remainingAfterCents).toBe(25000);

    const again = buildPrizeBatchPreview({ event, list, teams: demoTeams(), budgetLine, prizeTable, splitMode: "equal" });
    expect(again.senderBatchId).toBe(preview.senderBatchId);

    const proposal = prizePreviewToProposal(preview, { eventId: event.id, budgetLineId: budgetLine.id, uploadId: "up_1" });
    expect(proposal).toMatchObject({ kind: "prize", title: "Prizes for 3 winning teams", idempotencyKey: preview.senderBatchId });
    expect(proposal.items.every((i) => i.recipientKind === "confirmed_winner")).toBe(true);
  });

  it("pays the team lead by default", () => {
    const list = parsePrizeTable("place,team,amount\n1,Null Pointers,1000")!;
    const preview = buildPrizeBatchPreview({ event, list, teams: demoTeams(), budgetLine });
    expect(preview.items).toHaveLength(1);
    expect(preview.items[0]).toMatchObject({ memberName: "Asha Rao", amountCents: 100000 });
  });

  it("catches every planted mismatch", () => {
    const list = parsePrizeTable(
      [
        "place,team,amount,email",
        "1,Null Pointer,1000,", // typo -> suggestion, not auto-applied
        "2,Byte Me,600,", // prize table says 500
        "2,Stack Smashers,500,", // duplicate place
        "3,Merge Conflict,250,", // team not fully paid
        "3,Ghost Team,250,", // unknown
        "4,Byte Me,abc,", // unreadable amount
        "5,Stack Smashers,100,mallory@evil.test", // recipient not on team
      ].join("\n"),
    )!;
    const preview = buildPrizeBatchPreview({ event, list, teams: demoTeams(), budgetLine, prizeTable });
    const codes = preview.issues.map((i) => i.code);
    expect(preview.ok).toBe(false);
    expect(codes).toEqual(
      expect.arrayContaining([
        "team_not_found",
        "amount_mismatch",
        "duplicate_place",
        "team_not_eligible",
        "amount_unreadable",
        "recipient_not_in_team",
      ]),
    );
    expect(preview.issues.find((i) => i.code === "team_not_found" && i.line === 2)?.suggestion).toBe("Null Pointers");
    expect(preview.items.some((i) => i.email === "mallory@evil.test")).toBe(false);
    expect(() => prizePreviewToProposal(preview, { eventId: "e", budgetLineId: "b", uploadId: "u" })).toThrow();
  });

  it("flags totals over the budget line", () => {
    const list = parsePrizeTable("place,team,amount\n1,Null Pointers,1000\n2,Byte Me,500")!;
    const preview = buildPrizeBatchPreview({ event, list, teams: demoTeams(), budgetLine: { ...budgetLine, spentCents: 100000 } });
    expect(preview.issues.map((i) => i.code)).toContain("over_budget");
  });

  it("matches team names loosely but never guesses between similar names", () => {
    expect(matchTeam("TEAM null-pointers", demoTeams()).kind).toBe("exact");
    expect(matchTeam("Null Pointer", demoTeams())).toMatchObject({ kind: "none", suggestion: { teamName: "Null Pointers" } });
  });
});

import { createHash } from "node:crypto";
import { getDb, schema, eq, inArray } from "@treasurer/db";

const EVENT_ID = "evt_demo";
const EVENT_SLUG = "hackfest";
const EVENT_NAME = "HackFest 2026";
const FEE_CENTS = 2_500;
const SEED_PREFIX = "seed_";
const DEMO_NOTE =
  "[DEMO ONLY — synthetic fixture; not a verified PayPal transaction]";

const BUDGET_LINES = [
  {
    id: "bl_prizes",
    name: "Prizes",
    category: "prize",
    allocatedCents: 200_000,
  },
  {
    id: "bl_catering",
    name: "Catering",
    category: "vendor",
    allocatedCents: 150_000,
  },
  {
    id: "bl_venue",
    name: "Venue",
    category: "vendor",
    allocatedCents: 250_000,
  },
  {
    id: "bl_swag",
    name: "Swag",
    category: "vendor",
    allocatedCents: 75_000,
  },
] as const;

const WINNING_TEAMS = new Set([
  "Null Pointers",
  "Byte Me",
  "Stack Smashers",
]);

function registrationId(number: number): string {
  return `${SEED_PREFIX}reg_${String(number).padStart(3, "0")}`;
}

function memberId(number: number): string {
  return `${SEED_PREFIX}member_${String(number).padStart(3, "0")}`;
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertNonProduction(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to seed synthetic demo data when NODE_ENV=production.",
    );
  }
}

async function main(): Promise<void> {
  assertNonProduction();

  const db = await getDb();

  await db.transaction(async (tx) => {
    // Delete only records with IDs reserved for this seed script.
    // Never clear all records belonging to the demo event.
    await tx
      .delete(schema.invoices)
      .where(
        inArray(schema.invoices.id, [
          `${SEED_PREFIX}invoice_gold`,
          `${SEED_PREFIX}invoice_silver`,
        ]),
      );

    await tx
      .delete(schema.receipts)
      .where(
        inArray(schema.receipts.id, [
          `${SEED_PREFIX}receipt_catering`,
          `${SEED_PREFIX}receipt_venue`,
        ]),
      );

    const seededRegistrationIds = Array.from(
      { length: 300 },
      (_, index) => registrationId(index + 1),
    );

    const seededMemberIds = Array.from(
      { length: 300 },
      (_, index) => memberId(index + 1),
    );

    const seededRegistrationLedgerIds = seededRegistrationIds.map(
      (id) => `${SEED_PREFIX}ledger_${id}`,
    );

    await tx
      .delete(schema.ledgerEntries)
      .where(
        inArray(schema.ledgerEntries.id, [
          ...seededRegistrationLedgerIds,
          `${SEED_PREFIX}ledger_expense_prizes`,
          `${SEED_PREFIX}ledger_expense_catering`,
          `${SEED_PREFIX}ledger_expense_venue`,
        ]),
      );

    await tx
      .delete(schema.members)
      .where(inArray(schema.members.id, seededMemberIds));

    await tx
      .delete(schema.registrations)
      .where(inArray(schema.registrations.id, seededRegistrationIds));

    await tx
      .delete(schema.volunteers)
      .where(
        eq(schema.volunteers.id, `${SEED_PREFIX}volunteer_priya`),
      );

    await tx
      .delete(schema.vendors)
      .where(
        inArray(schema.vendors.id, [
          `${SEED_PREFIX}vendor_catering`,
          `${SEED_PREFIX}vendor_venue`,
          `${SEED_PREFIX}vendor_swag`,
        ]),
      );

    await tx
      .delete(schema.sponsors)
      .where(
        inArray(schema.sponsors.id, [
          `${SEED_PREFIX}sponsor_gold`,
          `${SEED_PREFIX}sponsor_silver`,
        ]),
      );

    // Create or update the demo event. The fixed ID and slug are reserved
    // for local/demo use; use a separate database for production data.
    const existingEvent = await tx
      .select({ id: schema.events.id })
      .from(schema.events)
      .where(eq(schema.events.id, EVENT_ID))
      .limit(1);

    if (existingEvent.length > 0) {
      await tx
        .update(schema.events)
        .set({
          slug: EVENT_SLUG,
          name: EVENT_NAME,
          currency: "USD",
          status: "active",
          feeCents: FEE_CENTS,
        })
        .where(eq(schema.events.id, EVENT_ID));
    } else {
      await tx.insert(schema.events).values({
        id: EVENT_ID,
        slug: EVENT_SLUG,
        name: EVENT_NAME,
        currency: "USD",
        status: "active",
        feeCents: FEE_CENTS,
      });
    }

    // Update only the reserved budget-line IDs.
    for (const line of BUDGET_LINES) {
      const existingLine = await tx
        .select({ id: schema.budgetLines.id })
        .from(schema.budgetLines)
        .where(eq(schema.budgetLines.id, line.id))
        .limit(1);

      if (existingLine.length > 0) {
        await tx
          .update(schema.budgetLines)
          .set({
            eventId: EVENT_ID,
            name: line.name,
            category: line.category,
            allocatedCents: line.allocatedCents,
          })
          .where(eq(schema.budgetLines.id, line.id));
      } else {
        await tx.insert(schema.budgetLines).values({
          ...line,
          eventId: EVENT_ID,
          spentCents: 0,
        });
      }
    }

    const registrations = Array.from({ length: 300 }, (_, index) => {
      const number = index + 1;

      let teamName = `HackFest Team ${String(number).padStart(3, "0")}`;

      if (number === 1) teamName = "Null Pointers";
      if (number === 2) teamName = "Byte Me";
      if (number === 3) teamName = "Stack Smashers";

      const isWinningTeam = WINNING_TEAMS.has(teamName);
      const isPaidWorkshopB = number <= 42;
      const isPartial = number === 43;

      const paidCents = isPaidWorkshopB || isWinningTeam
        ? FEE_CENTS
        : isPartial
          ? 1_000
          : 0;

      return {
        id: registrationId(number),
        eventId: EVENT_ID,
        teamName,
        track: isPaidWorkshopB ? "Workshop B" : number % 2 === 0
          ? "Workshop A"
          : "General",
        feeCents: FEE_CENTS,
        paidCents,
        status: paidCents === 0
          ? "pending" as const
          : paidCents < FEE_CENTS
            ? "partially_paid" as const
            : "paid" as const,
      };
    });

    await tx.insert(schema.registrations).values(registrations);

    const members = registrations.map((registration, index) => {
      const number = index + 1;
      const paddedNumber = String(number).padStart(3, "0");

      return {
        id: memberId(number),
        registrationId: registration.id,
        name: number === 43
          ? "Alex Morgan"
          : `Participant ${paddedNumber}`,
        email: `participant${paddedNumber}@example.edu`,
        isLead: true,
        shareCents: FEE_CENTS,
        paidCents: registration.paidCents,
        // Demo-only token. It must never authorize a real payment.
        payToken: `demo-only-${stableHash(registration.id)}`,
        nudgesSent: 0,
      };
    });

    await tx.insert(schema.members).values(members);

    await tx.insert(schema.volunteers).values({
      id: `${SEED_PREFIX}volunteer_priya`,
      eventId: EVENT_ID,
      name: "Priya Shah",
      email: "priya@example.edu",
    });

    await tx.insert(schema.vendors).values([
      {
        id: `${SEED_PREFIX}vendor_catering`,
        eventId: EVENT_ID,
        name: "Demo Catering Co.",
        email: "catering@example.com",
        allowlisted: true,
      },
      {
        id: `${SEED_PREFIX}vendor_venue`,
        eventId: EVENT_ID,
        name: "Demo Venue Services",
        email: "venue@example.com",
        allowlisted: true,
      },
      {
        id: `${SEED_PREFIX}vendor_swag`,
        eventId: EVENT_ID,
        name: "Demo Swag Studio",
        email: "swag@example.com",
        allowlisted: false,
      },
    ]);

    await tx.insert(schema.sponsors).values([
      {
        id: `${SEED_PREFIX}sponsor_gold`,
        eventId: EVENT_ID,
        name: "Example Gold Sponsor",
        tier: "Gold",
        contactName: "Jordan Lee",
        contactEmail: "jordan@example.com",
        amountCents: 500_000,
        deliverables: ["Demo logo placement", "Demo event mention"],
      },
      {
        id: `${SEED_PREFIX}sponsor_silver`,
        eventId: EVENT_ID,
        name: "Example Silver Sponsor",
        tier: "Silver",
        contactName: "Taylor Reed",
        contactEmail: "taylor@example.com",
        amountCents: 250_000,
        deliverables: ["Demo sponsor listing"],
      },
    ]);

    await tx.insert(schema.invoices).values([
      {
        id: `${SEED_PREFIX}invoice_gold`,
        sponsorId: `${SEED_PREFIX}sponsor_gold`,
        paypalInvoiceId: null,
        invoiceNumber: "DEMO-HF-001",
        amountCents: 500_000,
        dueDate: "2026-11-01",
        status: "draft",
      },
      {
        id: `${SEED_PREFIX}invoice_silver`,
        sponsorId: `${SEED_PREFIX}sponsor_silver`,
        paypalInvoiceId: null,
        invoiceNumber: "DEMO-HF-002",
        amountCents: 250_000,
        dueDate: "2026-11-05",
        status: "draft",
      },
    ]);

    // Synthetic receipt metadata only; no real files or uploads are created.
    await tx.insert(schema.receipts).values([
      {
        id: `${SEED_PREFIX}receipt_catering`,
        eventId: EVENT_ID,
        volunteerId: `${SEED_PREFIX}volunteer_priya`,
        submitterName: "Priya Shah",
        submitterEmail: "priya@example.edu",
        note: `${DEMO_NOTE} Catering receipt fixture.`,
        fileKey: "demo://receipts/catering-receipt",
        mimeType: "application/pdf",
        sha256: stableHash("autonomous-treasurer-demo-catering-receipt"),
        extraction: {
          demoOnly: true,
          vendor: "Demo Catering Co.",
          amountCents: 48_500,
          currency: "USD",
          confidence: 0.98,
        },
        status: "needs_review",
      },
      {
        id: `${SEED_PREFIX}receipt_venue`,
        eventId: EVENT_ID,
        volunteerId: `${SEED_PREFIX}volunteer_priya`,
        submitterName: "Priya Shah",
        submitterEmail: "priya@example.edu",
        note: `${DEMO_NOTE} Venue receipt fixture.`,
        fileKey: "demo://receipts/venue-receipt",
        mimeType: "application/pdf",
        sha256: stableHash("autonomous-treasurer-demo-venue-receipt"),
        extraction: {
          demoOnly: true,
          vendor: "Demo Venue Services",
          amountCents: 120_000,
          currency: "USD",
          confidence: 0.72,
        },
        status: "needs_review",
      },
    ]);

    // These rows are synthetic fixtures, not evidence of actual PayPal activity.
    const paidRegistrations = registrations.filter(
      (registration) => registration.paidCents > 0,
    );

    const registrationLedger = paidRegistrations.map((registration) => ({
      id: `${SEED_PREFIX}ledger_${registration.id}`,
      eventId: EVENT_ID,
      direction: "in" as const,
      amountCents: registration.paidCents,
      budgetLineId: null,
      paypalObjectType: null,
      paypalObjectId: null,
      businessObjectType: "registration",
      businessObjectId: registration.id,
      description:
        `${DEMO_NOTE} Registration payment fixture: ${registration.teamName}`,
      reconStatus: "unmatched" as const,
      reconNote:
        "Synthetic seed row; reconcile against the eval fixture, not live PayPal.",
      occurredAt: new Date("2026-10-15T12:00:00.000Z"),
    }));

    await tx.insert(schema.ledgerEntries).values(registrationLedger);

    await tx.insert(schema.ledgerEntries).values([
      {
        id: `${SEED_PREFIX}ledger_expense_prizes`,
        eventId: EVENT_ID,
        direction: "out",
        amountCents: 150_000,
        budgetLineId: "bl_prizes",
        paypalObjectType: null,
        paypalObjectId: null,
        businessObjectType: "demo_expense",
        businessObjectId: "demo_prize_pool",
        description: `${DEMO_NOTE} Planned prize expense fixture; not a payout.`,
        reconStatus: "unmatched",
        reconNote: "Synthetic fixture; no PayPal payout was executed.",
        occurredAt: new Date("2026-10-16T12:00:00.000Z"),
      },
      {
        id: `${SEED_PREFIX}ledger_expense_catering`,
        eventId: EVENT_ID,
        direction: "out",
        amountCents: 48_500,
        budgetLineId: "bl_catering",
        paypalObjectType: null,
        paypalObjectId: null,
        businessObjectType: "demo_expense",
        businessObjectId: "demo_catering",
        description: `${DEMO_NOTE} Catering expense fixture; not a payment.`,
        reconStatus: "unmatched",
        reconNote: "Synthetic fixture; no PayPal payment was executed.",
        occurredAt: new Date("2026-10-16T13:00:00.000Z"),
      },
      {
        id: `${SEED_PREFIX}ledger_expense_venue`,
        eventId: EVENT_ID,
        direction: "out",
        amountCents: 120_000,
        budgetLineId: "bl_venue",
        paypalObjectType: null,
        paypalObjectId: null,
        businessObjectType: "demo_expense",
        businessObjectId: "demo_venue",
        description: `${DEMO_NOTE} Venue expense fixture; not a payment.`,
        reconStatus: "unmatched",
        reconNote: "Synthetic fixture; no PayPal payment was executed.",
        occurredAt: new Date("2026-10-17T13:00:00.000Z"),
      },
    ]);
  });

  console.log(`Seeded ${EVENT_NAME} (${EVENT_ID}).`);
  console.log("Registrations: 300");
  console.log("Paid Workshop B registrations: 42");
  console.log("Partially paid registrations: 1");
  console.log(
    "Prize-winning teams: Null Pointers, Byte Me, Stack Smashers",
  );
  console.log(
    "All payment and expense ledger entries are synthetic demo fixtures.",
  );
}

main().catch((error: unknown) => {
  console.error("Failed to seed Autonomous Treasurer demo data:", error);
  process.exitCode = 1;
});

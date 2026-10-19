import {
  matchLedgerEntries,
  type LedgerEntryForRecon,
  type MatchResult,
  type PayPalTransactionForRecon,
} from "../../packages/recon/src/index";

type EvaluationCase = {
  name: string;
  ledger: LedgerEntryForRecon[];
  paypal: PayPalTransactionForRecon[];
  expectedStatuses: MatchResult["status"][];
};

type RegistrationFixture = {
  registrationNumber: number;
  ledger: LedgerEntryForRecon;
  transaction: PayPalTransactionForRecon;
  plantedError: "none" | "duplicate" | "wrong_amount";
};

const REGISTRATION_COUNT = 300;
const REGISTRATION_FEE_CENTS = 2500;
const ORPHAN_TRANSACTION_ID = "eval-orphan-extra";

function assert(
  condition: boolean,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function createLedgerEntry(
  id: string,
  amountCents: number,
  businessObjectId: string | null,
): LedgerEntryForRecon {
  return {
    id,
    amountCents,
    businessObjectType: businessObjectId ? "registration" : null,
    businessObjectId,
    paypalObjectType: null,
    paypalObjectId: null,
  };
}

function createTransaction(
  id: string,
  amountCents: number,
  customId: string | null,
): PayPalTransactionForRecon {
  return {
    id,
    type: "capture",
    amountCents,
    customId,
  };
}

function evaluateCase(testCase: EvaluationCase): MatchResult[] {
  const results = matchLedgerEntries(testCase.ledger, testCase.paypal);

  assert(
    results.length === testCase.ledger.length,
    `${testCase.name}: expected one result per ledger entry`,
  );

  for (let index = 0; index < testCase.expectedStatuses.length; index += 1) {
    const result = results[index];
    const expectedStatus = testCase.expectedStatuses[index];

    assert(
      result?.status === expectedStatus,
      `${testCase.name}: expected status ${expectedStatus} at index ${index}, got ${result?.status}`,
    );
  }

  return results;
}

function createRegistrationFixtures(): RegistrationFixture[] {
  return Array.from({ length: REGISTRATION_COUNT }, (_, index) => {
    const number = index + 1;
    const registrationId = `eval-reg-${String(number).padStart(3, "0")}`;
    const ledgerId = `eval-ledger-${String(number).padStart(3, "0")}`;
    const transactionId = `eval-capture-${String(number).padStart(3, "0")}`;

    return {
      registrationNumber: number,
      ledger: createLedgerEntry(
        ledgerId,
        REGISTRATION_FEE_CENTS,
        registrationId,
      ),
      transaction: createTransaction(
        transactionId,
        REGISTRATION_FEE_CENTS,
        `reg:${registrationId}`,
      ),
      plantedError: "none",
    };
  });
}

function runTargetedScenarios(): void {
  const cases: EvaluationCase[] = [
    {
      name: "Exact payment match",
      ledger: [createLedgerEntry("ledger-exact", 2500, "reg-exact")],
      paypal: [createTransaction("capture-exact", 2500, "reg:reg-exact")],
      expectedStatuses: ["matched"],
    },
    {
      name: "Duplicate payment candidates",
      ledger: [createLedgerEntry("ledger-duplicate", 2500, "reg-duplicate")],
      paypal: [
        createTransaction("capture-duplicate-a", 2500, "reg:reg-duplicate"),
        createTransaction("capture-duplicate-b", 2500, "reg:reg-duplicate"),
      ],
      expectedStatuses: ["flagged"],
    },
    {
      name: "Wrong amount with exact custom ID",
      ledger: [createLedgerEntry("ledger-wrong-amount", 2500, "reg-wrong")],
      paypal: [createTransaction("capture-wrong-amount", 2000, "reg:reg-wrong")],
      expectedStatuses: ["flagged"],
    },
    {
      name: "Orphan PayPal transaction",
      ledger: [createLedgerEntry("ledger-existing", 2500, "reg-existing")],
      paypal: [
        createTransaction("capture-existing", 2500, "reg:reg-existing"),
        createTransaction("capture-orphan", 4200, "reg:reg-does-not-exist"),
      ],
      expectedStatuses: ["matched"],
    },
    {
      name: "Amount-only evidence is not confirmed",
      ledger: [createLedgerEntry("ledger-amount-only", 2500, null)],
      paypal: [createTransaction("capture-amount-only", 2500, null)],
      expectedStatuses: ["suggested"],
    },
  ];

  console.log("Targeted regression scenarios");

  for (const testCase of cases) {
    const results = evaluateCase(testCase);

    if (testCase.name === "Orphan PayPal transaction") {
      const assignedIds = new Set(
        results
          .filter(
            (result) =>
              result.status === "matched" || result.status === "flagged",
          )
          .map((result) => result.matchedTo?.id)
          .filter((id): id is string => Boolean(id)),
      );

      const orphan = testCase.paypal.find(
        (transaction) => transaction.id === "capture-orphan",
      );

      assert(orphan, "Orphan scenario: planted orphan transaction is missing");
      assert(
        !assignedIds.has(orphan.id),
        "Orphan scenario: expected capture-orphan to remain unassigned",
      );
    }

    console.log(`PASS ${testCase.name}`);
  }
}

function runScaleEvaluation(): void {
  const fixtures = createRegistrationFixtures();

  // Plant a duplicate candidate for one registration.
  fixtures[9]!.plantedError = "duplicate";

  // Plant a wrong-amount transaction with an otherwise correct custom ID.
  fixtures[19]!.plantedError = "wrong_amount";
  fixtures[19]!.transaction.amountCents = 2000;

  const ledger = fixtures.map((fixture) => fixture.ledger);
  const paypal = fixtures.map((fixture) => fixture.transaction);

  const duplicateFixture = fixtures[9]!;

  paypal.push(
    createTransaction(
      "eval-duplicate-extra",
      REGISTRATION_FEE_CENTS,
      duplicateFixture.transaction.customId,
    ),
  );

  // This transaction has no corresponding ledger entry.
  paypal.push(
    createTransaction(
      ORPHAN_TRANSACTION_ID,
      4200,
      "reg:registration-not-in-ledger",
    ),
  );

  const results = matchLedgerEntries(ledger, paypal);

  assert(
    results.length === REGISTRATION_COUNT,
    `Scale evaluation: expected ${REGISTRATION_COUNT} ledger results, got ${results.length}`,
  );

  const resultByLedgerId = new Map(
    results.map((result) => [result.ledgerEntryId, result]),
  );

  const duplicateResult = resultByLedgerId.get(duplicateFixture.ledger.id);
  const wrongAmountFixture = fixtures[19]!;
  const wrongAmountResult = resultByLedgerId.get(wrongAmountFixture.ledger.id);

  const duplicateCaught = duplicateResult?.status === "flagged";
  const wrongAmountCaught = wrongAmountResult?.status === "flagged";

  // The matcher returns results for ledger entries, not a complete list of
  // orphan transactions. Use the known planted transaction ID as evaluation
  // ground truth rather than treating every unassigned transaction as an orphan.
  const assignedIds = new Set(
    results
      .filter(
        (result) => result.status === "matched" || result.status === "flagged",
      )
      .map((result) => result.matchedTo?.id)
      .filter((id): id is string => Boolean(id)),
  );

  const plantedOrphan = paypal.find(
    (transaction) => transaction.id === ORPHAN_TRANSACTION_ID,
  );

  const orphanCaught =
    plantedOrphan !== undefined && !assignedIds.has(plantedOrphan.id);

  console.log("\n300-registration scale evaluation");
  console.log(`Ledger entries: ${ledger.length}`);
  console.log(`PayPal transactions: ${paypal.length}`);
  console.log(
    `Duplicate payment: ${duplicateCaught ? "DETECTED" : "MISSED"}`,
  );
  console.log(
    `Wrong amount: ${wrongAmountCaught ? "DETECTED" : "MISSED"}`,
  );
  console.log(
    `Planted orphan transaction: ${orphanCaught ? "DETECTED" : "MISSED"}`,
  );

  assert(duplicateCaught, "Scale evaluation failed to flag duplicate candidates");
  assert(wrongAmountCaught, "Scale evaluation failed to flag wrong amount");
  assert(orphanCaught, "Scale evaluation failed to identify the planted orphan");

  console.log("PASS scale evaluation checks");
}

function main(): void {
  console.log("Autonomous Treasurer — Reconciliation Evaluation");
  console.log("Synthetic fixtures only; no PayPal calls or database writes.\n");

  runTargetedScenarios();
  runScaleEvaluation();

  console.log("\nAll reconciliation evaluation checks passed.");
}

try {
  main();
} catch (error: unknown) {
  console.error("\nReconciliation evaluation failed:", error);
  process.exitCode = 1;
}
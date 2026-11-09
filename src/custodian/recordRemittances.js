// Plain-English overview: the custodian's side of reconciliation. Given
// the remittance instructions payroll sent (remittance/instructions.js)
// and what the custodian actually received, record each remittance on
// the ReconciliationLedger against the ledger IDs payroll supplied.
//
// Two rules this file exists to keep:
//
// 1. The custodian never holds the employee-ID key. Payroll is the system
//    of record for employee IDs; this module takes ledger IDs as given
//    and has no way to compute one. tests/custodianRecord.test.js checks
//    this file never imports chain/ledgerIds.js or reads the key.
//
// 2. Record what was actually received, never what payroll said to
//    expect. The instruction's amount is NOT used as a fallback or a
//    correction. If the received amount differs, the ledger flags
//    AmountMismatch for a human to resolve - that is the system working,
//    not an error to smooth over.

/**
 * recordRemittancesFromInstructions
 * -----------------------------------
 * custodianClient: a createChainClient(...) instance signing as the
 *   registered custodian (pass signerPrivateKey).
 * lines: parsed remittance instructions.
 * receiptFor: (line) => { amountCents, remittedAt } for funds actually
 *   received for that line, or null if nothing has arrived yet.
 *
 * Returns one outcome per line: { line, recorded: true, amountCents,
 * remittedAt } | { line, skipped: true, reason } | { line, error }.
 * One line's failure never stops the rest.
 */
async function recordRemittancesFromInstructions(custodianClient, lines, receiptFor) {
  const outcomes = [];
  for (const line of lines) {
    try {
      const receipt = receiptFor(line);
      if (!receipt) {
        outcomes.push({ line, skipped: true, reason: "no funds received for this line yet" });
        continue;
      }
      const { amountCents, remittedAt } = receipt;
      if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
        throw new Error("received amountCents must be a non-negative integer (the actual amount received, not the instructed one)");
      }
      if (!Number.isSafeInteger(remittedAt) || remittedAt <= 0) {
        throw new Error("remittedAt must be a positive integer (unix seconds)");
      }
      await custodianClient.recordRemittance(line.ledgerEmployeeId, line.ledgerPayPeriodId, amountCents, remittedAt);
      outcomes.push({ line, recorded: true, amountCents, remittedAt });
    } catch (error) {
      outcomes.push({ line, error: error.message });
    }
  }
  return outcomes;
}

module.exports = { recordRemittancesFromInstructions };

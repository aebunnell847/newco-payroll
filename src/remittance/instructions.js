// Plain-English overview: the remittance instructions payroll sends the
// custodian after a payroll run - one line per employee whose
// contribution was written to the reconciliation ledger.
//
// Payroll is the system of record for employee IDs. The secret that turns
// an employee ID into its on-chain ledger ID (NEWCO_EMPLOYEE_ID_KEY, see
// chain/ledgerIds.js) never leaves payroll, even when payroll and the
// custodian sit under the same corporate umbrella. Instead each line here
// carries the ledger ID itself, so the custodian can record its side of
// the ledger against exactly the same ID without being able to compute
// it, reverse it, or derive anyone else's.
//
// What a line deliberately does NOT contain: the employee's internal ID,
// name, or anything else that identifies the person. Crediting the right
// participant account is done through the existing private contribution
// file between payroll and the custodian; this file only links each
// payment to its public ledger entry.
//
// Wire format is CSV with a fixed header, so it is easy to inspect, diff,
// and hand to a custodian's existing file-intake process.

const CSV_HEADER = "ledger_employee_id,ledger_pay_period_id,amount_cents,withheld_at";
const BYTES32_RE = /^0x[0-9a-f]{64}$/;

function validateLine(line, where) {
  const fail = (msg) => {
    throw new Error(`${where}: ${msg}`);
  };
  if (!BYTES32_RE.test(line.ledgerEmployeeId)) fail("ledger_employee_id must be a 0x-prefixed lowercase 32-byte hex value");
  if (!BYTES32_RE.test(line.ledgerPayPeriodId)) fail("ledger_pay_period_id must be a 0x-prefixed lowercase 32-byte hex value");
  if (!Number.isSafeInteger(line.amountCents) || line.amountCents < 0) fail("amount_cents must be a non-negative integer");
  if (!Number.isSafeInteger(line.withheldAt) || line.withheldAt <= 0) fail("withheld_at must be a positive integer (unix seconds)");
}

function assertNoDuplicates(lines) {
  const seen = new Set();
  lines.forEach((line, i) => {
    const k = line.ledgerEmployeeId + "/" + line.ledgerPayPeriodId;
    if (seen.has(k)) throw new Error(`line ${i + 1}: duplicate entry for the same ledger employee ID and pay period`);
    seen.add(k);
  });
}

/**
 * buildRemittanceInstructions
 * -----------------------------
 * outcomes: the array returned by runPayrollBatch. Only outcomes with a
 * ledgerEntry (a contribution actually written on-chain) become lines;
 * skipped, failed, and dry-run outcomes are left out, because there is no
 * ledger entry for a custodian to reconcile against.
 */
function buildRemittanceInstructions(outcomes) {
  const lines = outcomes
    .filter((o) => o && o.ledgerEntry)
    .map(({ ledgerEntry }) => ({
      ledgerEmployeeId: ledgerEntry.ledgerEmployeeId,
      ledgerPayPeriodId: ledgerEntry.ledgerPayPeriodId,
      amountCents: ledgerEntry.amountCents,
      withheldAt: ledgerEntry.withheldAt,
    }));
  lines.forEach((line, i) => validateLine(line, `line ${i + 1}`));
  assertNoDuplicates(lines);
  return lines;
}

function toRemittanceCsv(lines) {
  lines.forEach((line, i) => validateLine(line, `line ${i + 1}`));
  assertNoDuplicates(lines);
  const rows = lines.map((l) => [l.ledgerEmployeeId, l.ledgerPayPeriodId, l.amountCents, l.withheldAt].join(","));
  return [CSV_HEADER, ...rows].join("\n") + "\n";
}

/**
 * parseRemittanceCsv
 * --------------------
 * The custodian's side of the handoff. Strict on purpose: an unexpected
 * header, a malformed ID, or a duplicate row rejects the whole file with
 * the offending line number, rather than recording a partial or guessed
 * set of remittances.
 */
function parseRemittanceCsv(text) {
  const rows = String(text).replace(/\r\n/g, "\n").split("\n").filter((r) => r.trim() !== "");
  if (rows.length === 0 || rows[0].trim() !== CSV_HEADER) {
    throw new Error(`remittance file must start with the header: ${CSV_HEADER}`);
  }
  const lines = rows.slice(1).map((row, i) => {
    const where = `line ${i + 2}`;
    const cols = row.split(",").map((c) => c.trim());
    if (cols.length !== 4) throw new Error(`${where}: expected 4 columns, got ${cols.length}`);
    const [ledgerEmployeeId, ledgerPayPeriodId, amount, withheld] = cols;
    if (!/^\d+$/.test(amount)) throw new Error(`${where}: amount_cents must be a non-negative integer`);
    if (!/^\d+$/.test(withheld)) throw new Error(`${where}: withheld_at must be a positive integer (unix seconds)`);
    const line = {
      ledgerEmployeeId,
      ledgerPayPeriodId,
      amountCents: Number(amount),
      withheldAt: Number(withheld),
    };
    validateLine(line, where);
    return line;
  });
  assertNoDuplicates(lines);
  return lines;
}

module.exports = { buildRemittanceInstructions, toRemittanceCsv, parseRemittanceCsv, CSV_HEADER };

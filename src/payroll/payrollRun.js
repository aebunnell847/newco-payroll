// Plain-English overview: this is the orchestration layer - the piece
// that takes a batch of employees and a pay period, runs the (already
// tested) payroll math for each one, checks consent before touching
// anything gated, and then writes the result to the reconciliation
// ledger. It depends on both payrollEngine.js and chain/contracts.js, but
// stays thin on purpose: all the actual logic lives in those two files,
// each independently testable.

const { runPayrollForEmployee } = require("./payrollEngine");
const { toBytes32Id } = require("../chain/contracts");
const { toLedgerEmployeeId, parseEmployeeIdKey } = require("../chain/ledgerIds");

/**
 * runPayrollBatch
 * -----------------
 * employees: array of employee objects (see src/models/Employee.js)
 * payPeriod: { id, taxYear, regularHours?, overtimeHours? } - taxYear is
 *            the year the pay date falls in; it picks the IRS limits.
 * options:
 *   chainClient            - the object returned by createChainClient(),
 *                             or null/undefined to skip all chain calls
 *                             (useful for a dry run / preview).
 *   consentAttestationFor  - (employee) => attestationId | null. If it
 *                             returns null, this employee is skipped
 *                             entirely rather than defaulting to "proceed
 *                             anyway" - consent must be explicit.
 *   yearToDateDeferralFor  - (employee) => cents already deferred this year
 *   yearToDateFicaWagesFor - (employee) => gross already paid this calendar
 *                             year (Social Security wage base, Additional
 *                             Medicare threshold). Defaults to 0, i.e. the
 *                             first paycheck of the year; the data layer
 *                             supplies the real figure.
 *   monthToDateFor         - (employee) => { grossCents, localities } already
 *                             paid this calendar month, for monthly local
 *                             taxes (Denver OPT). Defaults to null; a state
 *                             rule that needs it throws rather than guess.
 *   yearToDateSupplementalFor - (employee) => supplemental wages already paid
 *                             this calendar year (federal 37% over $1M)
 *   employeeIdKey          - hex secret (NEWCO_EMPLOYEE_ID_KEY) used to
 *                             derive each employee's on-chain ID; see
 *                             chain/ledgerIds.js. Required whenever
 *                             chainClient is set.
 *   plan                   - { allowsCatchUp?: boolean, supplementalMethod?:
 *                             "aggregate" | "flat" } plan features; catch-up
 *                             is off unless the plan says so, and bonuses are
 *                             aggregated with regular pay unless the plan
 *                             elects the flat 22% (regulatory/supplemental.js).
 *   hoursFor               - optional (employee) => { regularHours,
 *                             overtimeHours }. When given, each employee's
 *                             own hours replace the pay period's shared
 *                             ones (see data/payrollStore.js timesheets).
 *
 * Returns an array of { employee, result, ledgerEntry?, skipped?,
 * skipReason?, error? } so the caller can see exactly what happened for
 * every employee, not just an aggregate pass/fail.
 *
 * ledgerEntry is set only when a contribution was actually written to the
 * chain: { ledgerEmployeeId, ledgerPayPeriodId, amountCents, withheldAt }.
 * It is what payroll sends the custodian (see remittance/instructions.js),
 * so the custodian can record against the same ledger IDs without ever
 * holding the employee-ID key. Payroll is the system of record for that
 * mapping.
 */
async function runPayrollBatch(employees, payPeriod, options = {}) {
  const {
    chainClient = null,
    consentAttestationFor = () => null,
    yearToDateDeferralFor = () => 0,
    yearToDateFicaWagesFor = () => 0,
    monthToDateFor = () => null,
    yearToDateSupplementalFor = () => 0,
    employeeIdKey = null,
    plan = {},
    hoursFor = null,
  } = options;

  // Validate the key once, before touching anyone: a missing or weak key
  // is a configuration error for the whole run, not a per-employee one,
  // and must never fall back to a guessable plain hash.
  if (chainClient) parseEmployeeIdKey(employeeIdKey);

  const outcomes = [];

  for (const employee of employees) {
    const attestationId = consentAttestationFor(employee);

    if (chainClient && !attestationId) {
      outcomes.push({
        employee,
        skipped: true,
        skipReason: "no active consent attestation on file for this employee",
      });
      continue;
    }

    try {
      if (chainClient && attestationId) {
        // Hard stop per-employee if consent isn't active - this is the one
        // place in the whole system where "no" should actually stop
        // something, as distinct from the reconciliation ledger's
        // never-auto-block guardrail.
        await chainClient.assertConsentActive(attestationId);
      }

      const yearToDateDeferralCents = yearToDateDeferralFor(employee);
      const employeePeriod = hoursFor ? { ...payPeriod, ...hoursFor(employee) } : payPeriod;
      const result = runPayrollForEmployee(
        employee,
        employeePeriod,
        yearToDateDeferralCents,
        plan,
        yearToDateFicaWagesFor(employee),
        monthToDateFor(employee),
        yearToDateSupplementalFor(employee)
      );

      let ledgerEntry;
      if (chainClient) {
        const employeeIdBytes32 = toLedgerEmployeeId(employee.id, employeeIdKey);
        const payPeriodBytes32 = toBytes32Id(payPeriod.id);
        const withheldAt = Math.floor(Date.now() / 1000);

        await chainClient.recordContribution(
          employeeIdBytes32,
          payPeriodBytes32,
          result.contribution401k.actualCents,
          withheldAt
        );

        ledgerEntry = {
          ledgerEmployeeId: employeeIdBytes32,
          ledgerPayPeriodId: payPeriodBytes32,
          amountCents: result.contribution401k.actualCents,
          withheldAt,
        };
      }

      outcomes.push(ledgerEntry ? { employee, result, ledgerEntry } : { employee, result });
    } catch (error) {
      // Record the failure per-employee and keep going - one employee's
      // problem (bad data, consent revoked, a chain call failing) should
      // never silently abort the whole payroll run for everyone else.
      outcomes.push({ employee, error: error.message });
    }
  }

  return outcomes;
}

module.exports = { runPayrollBatch };

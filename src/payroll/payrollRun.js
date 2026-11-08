// Plain-English overview: this is the orchestration layer - the piece
// that takes a batch of employees and a pay period, runs the (already
// tested) payroll math for each one, checks consent before touching
// anything gated, and then writes the result to the reconciliation
// ledger. It depends on both payrollEngine.js and chain/contracts.js, but
// stays thin on purpose: all the actual logic lives in those two files,
// each independently testable.

const { runPayrollForEmployee } = require("./payrollEngine");
const { toBytes32Id } = require("../chain/contracts");

/**
 * runPayrollBatch
 * -----------------
 * employees: array of employee objects (see src/models/Employee.js)
 * payPeriod: { id, regularHours?, overtimeHours? }
 * options:
 *   chainClient            - the object returned by createChainClient(),
 *                             or null/undefined to skip all chain calls
 *                             (useful for a dry run / preview).
 *   consentAttestationFor  - (employee) => attestationId | null. If it
 *                             returns null, this employee is skipped
 *                             entirely rather than defaulting to "proceed
 *                             anyway" - consent must be explicit.
 *   yearToDateDeferralFor  - (employee) => cents already deferred this year
 *
 * Returns an array of { employee, result, skipped?, skipReason?, error? }
 * so the caller can see exactly what happened for every employee, not
 * just an aggregate pass/fail.
 */
async function runPayrollBatch(employees, payPeriod, options = {}) {
  const {
    chainClient = null,
    consentAttestationFor = () => null,
    yearToDateDeferralFor = () => 0,
  } = options;

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
      const result = runPayrollForEmployee(employee, payPeriod, yearToDateDeferralCents);

      if (chainClient) {
        const employeeIdBytes32 = toBytes32Id(employee.id);
        const payPeriodBytes32 = toBytes32Id(payPeriod.id);
        const withheldAt = Math.floor(Date.now() / 1000);

        await chainClient.recordContribution(
          employeeIdBytes32,
          payPeriodBytes32,
          result.contribution401k.actualCents,
          withheldAt
        );
      }

      outcomes.push({ employee, result });
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

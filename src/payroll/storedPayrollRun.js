// Plain-English overview: runs payroll for one pay period straight from
// the data layer (data/payrollStore.js) and saves what happened. It is
// thin on purpose: the math is payrollEngine.js, the consent check and
// ledger write are payrollRun.js, and this file only supplies them with
// records instead of caller-provided values:
//   - employees      -> every active employee in the store
//   - hours          -> each hourly employee's own timesheet
//   - YTD deferrals  -> summed from earlier paid results this tax year
//   - prior-year FICA wages -> from the fica_wages table (Roth catch-up)
//   - YTD FICA wages -> summed gross from earlier paid results this year
//                      (Social Security wage base, Additional Medicare)
//   - Form W-4       -> the elections on the employee record
//   - consent        -> the attestation ID on the employee record
//
// Re-running a period is safe: employees already paid for it are left out
// and listed in alreadyPaid, and skipped/failed employees are retried.
//
// One gap to know about: the ledger write happens before the result is
// saved. If the process dies between the two, the retry's ledger write is
// refused by the contract ("already recorded") and that employee comes
// back as an error for a person to resolve - it is never paid twice.

const { runPayrollBatch } = require("./payrollRun");
const { buildRemittanceInstructions } = require("../remittance/instructions");

/**
 * runStoredPayroll(store, payPeriodId, options)
 * options: { chainClient?, employeeIdKey?, plan? } - same meaning as in
 * runPayrollBatch.
 *
 * Returns { payPeriod, alreadyPaid: [employeeId], outcomes } where
 * outcomes is runPayrollBatch's array (plus missing-timesheet errors).
 */
async function runStoredPayroll(store, payPeriodId, options = {}) {
  const { chainClient = null, employeeIdKey = null, plan = {} } = options;

  const payPeriod = store.getPayPeriod(payPeriodId);
  if (!payPeriod) throw new Error(`no pay period ${payPeriodId}`);

  const alreadyPaid = [];
  const missingTimesheet = [];
  const toRun = [];

  for (const employee of store.listActiveEmployees()) {
    if (store.getResult(employee.id, payPeriod.id)?.outcome === "paid") {
      alreadyPaid.push(employee.id);
      continue;
    }
    // A missing timesheet is not "zero hours": flag it instead of paying $0.
    if (employee.payType === "hourly" && !store.getHours(employee.id, payPeriod.id)) {
      missingTimesheet.push({ employee, error: `no timesheet on file for ${payPeriod.id}` });
      continue;
    }
    toRun.push({
      ...employee,
      priorYearFicaWagesCents: store.getFicaWages(employee.id, payPeriod.taxYear - 1) ?? undefined,
    });
  }

  const outcomes = await runPayrollBatch(toRun, payPeriod, {
    chainClient,
    employeeIdKey,
    plan,
    consentAttestationFor: (e) => e.consentAttestationId,
    yearToDateDeferralFor: (e) => store.yearToDateDeferralCents(e.id, payPeriod.taxYear),
    yearToDateFicaWagesFor: (e) => store.yearToDateFicaWagesCents(e.id, payPeriod.taxYear),
    monthToDateFor: (e) => store.monthToDate(e.id, payPeriod.payDate),
    yearToDateSupplementalFor: (e) => store.yearToDateSupplementalCents(e.id, payPeriod.taxYear),
    hoursFor: (e) => ({
      ...(e.payType === "hourly" ? store.getHours(e.id, payPeriod.id) : {}),
      supplementalCents: store.getSupplemental(e.id, payPeriod.id),
    }),
  });

  const all = [...missingTimesheet, ...outcomes];
  store.saveOutcomes(payPeriod, all);
  return { payPeriod, alreadyPaid, outcomes: all };
}

/**
 * The remittance instructions for a pay period, rebuilt from saved
 * results: one line per paid employee whose contribution is on the ledger.
 * Same lines runPayrollBatch's outcomes would give, but available any time
 * after the run, not only in the process that ran it.
 */
function remittanceInstructionsForPeriod(store, payPeriodId) {
  const outcomes = store
    .listResults(payPeriodId)
    .filter((r) => r.outcome === "paid" && r.ledgerEmployeeId)
    .map((r) => ({
      ledgerEntry: {
        ledgerEmployeeId: r.ledgerEmployeeId,
        ledgerPayPeriodId: r.ledgerPayPeriodId,
        amountCents: r.deferralCents,
        withheldAt: r.withheldAt,
      },
    }));
  return buildRemittanceInstructions(outcomes);
}

module.exports = { runStoredPayroll, remittanceInstructionsForPeriod };

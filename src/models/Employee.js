// Plain-English overview: a minimal in-memory shape for "one employee,"
// containing only what the payroll math needs to run. This is NOT where
// real PII (name, SSN, bank account, address, etc.) should ever live in
// production - per Tenet 1, raw PII belongs in an access-controlled store
// that the employee's own wallet gates access to, not in a plain object
// sitting in application memory or a conventional database row. What's
// modeled here deliberately excludes anything sensitive like that; it's
// scoped to pay-calculation inputs, which is a narrower exposure.
//
// Fields:
//   id                  - an opaque identifier (should correspond to the
//                          on-chain employeeId used in ReconciliationLedger
//                          via the keyed hash in chain/ledgerIds.js, never
//                          a plain hash; and never a
//                          real name or SSN)
//   payType             - "salary" | "hourly"
//   annualSalaryCents   - required if payType === "salary"
//   payPeriodsPerYear   - required for everyone (e.g. 26 = biweekly):
//                          salary is divided by it, and withholding
//                          annualizes every paycheck with it
//   hourlyRateCents     - required if payType === "hourly"
//   deferralElectionPct - the employee's elected 401(k) deferral, 0-100
//   birthYear           - optional; decides catch-up eligibility (the IRS
//                          test is age attained by year end). A year, not a
//                          full date of birth, and it never goes on-chain.
//   priorYearFicaWagesCents - optional; prior-year FICA wages from this
//                          employer, which decide whether catch-up
//                          contributions must be Roth (IRC 414(v)(7))
//   w4                  - the employee's Form W-4 elections (see
//                          regulatory/federalWithholding.js), or null if
//                          none is on file (IRS default: Single, no
//                          adjustments)

function createEmployee({
  id,
  payType,
  annualSalaryCents,
  payPeriodsPerYear,
  hourlyRateCents,
  deferralElectionPct = 0,
  birthYear,
  priorYearFicaWagesCents,
  w4 = null,
}) {
  if (!id) throw new Error("employee requires an id");
  if (payType !== "salary" && payType !== "hourly") {
    throw new Error('payType must be "salary" or "hourly"');
  }

  return {
    id,
    payType,
    annualSalaryCents,
    payPeriodsPerYear,
    hourlyRateCents,
    deferralElectionPct,
    birthYear,
    priorYearFicaWagesCents,
    w4,
  };
}

module.exports = { createEmployee };

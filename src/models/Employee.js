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
//                          on-chain employeeId used in ReconciliationLedger,
//                          itself ideally a hash/pseudonym rather than a
//                          real name or SSN)
//   payType             - "salary" | "hourly"
//   annualSalaryCents   - required if payType === "salary"
//   payPeriodsPerYear   - required if payType === "salary" (e.g. 26 = biweekly)
//   hourlyRateCents     - required if payType === "hourly"
//   deferralElectionPct - the employee's elected 401(k) deferral, 0-100

function createEmployee({
  id,
  payType,
  annualSalaryCents,
  payPeriodsPerYear,
  hourlyRateCents,
  deferralElectionPct = 0,
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
  };
}

module.exports = { createEmployee };

// SPDX-License-Identifier: MIT
//
// Plain-English overview: this is the core math for one payroll run, for
// one employee. It is deliberately isolated from anything blockchain- or
// database-related so it's easy to test and easy to audit - a payroll
// engine that's hard to verify is a payroll engine nobody should trust.
//
// Money is handled in INTEGER CENTS everywhere, never floating-point
// dollars. This matches the convention already used in the
// ReconciliationLedger smart contract (see newco-contracts), and it avoids
// the classic "floating point rounding error turns into a payroll
// discrepancy" bug class entirely.

/**
 * IMPORTANT: the tax and contribution-limit numbers below are PLACEHOLDERS,
 * not verified current figures. They exist so the math has something to run
 * against while this is being built. Before this is used for anything real:
 *   - Federal/state/local tax withholding must come from the RAG-over-
 *     regulatory-text system described in research/regulatory-rag-architecture.md
 *     (IRS/Treasury partition), not a hardcoded flat rate.
 *   - The 401(k) elective deferral limit must come from the current IRS
 *     annual limit (it changes most years) via the same system, not a
 *     hardcoded number here.
 * Hardcoding either of these and shipping it would violate the whole point
 * of NewCo's "minimize raw LLM/guessed knowledge, ground everything in
 * regulator source text" design goal.
 */
const PLACEHOLDER_CONFIG = {
  flatFederalWithholdingRate: 0.12, // NOT a real bracket calculation
  flatStateWithholdingRate: 0.05, // NOT a real state calculation
  annual401kElectiveDeferralLimitCents: 23_500_00, // PLACEHOLDER - verify via RAG system before real use
};

/**
 * computeGrossPayCents
 * ---------------------
 * Supports both salaried and hourly employees. Salaried: divide the annual
 * salary by how many pay periods occur in a year. Hourly: hours * rate,
 * plus 1.5x for anything over 40 hours in the period (a simplified
 * overtime rule - real overtime law varies by state and is itself a RAG
 * question, not a hardcoded 1.5x in every jurisdiction).
 */
function computeGrossPayCents(employee, payPeriod) {
  if (employee.payType === "salary") {
    const { annualSalaryCents, payPeriodsPerYear } = employee;
    if (!annualSalaryCents || !payPeriodsPerYear) {
      throw new Error("salaried employee missing annualSalaryCents or payPeriodsPerYear");
    }
    return Math.round(annualSalaryCents / payPeriodsPerYear);
  }

  if (employee.payType === "hourly") {
    const { hourlyRateCents } = employee;
    const { regularHours = 0, overtimeHours = 0 } = payPeriod;
    if (!hourlyRateCents) {
      throw new Error("hourly employee missing hourlyRateCents");
    }
    const regularPay = regularHours * hourlyRateCents;
    const overtimePay = overtimeHours * hourlyRateCents * 1.5;
    return Math.round(regularPay + overtimePay);
  }

  throw new Error(`unknown payType: ${employee.payType}`);
}

/**
 * computeTaxWithholdingCents
 * ---------------------------
 * A deliberately simple stand-in. Real withholding depends on filing
 * status, W-4 elections, state/local jurisdiction, and the current IRS
 * withholding tables - exactly the kind of thing meant to be retrieved from
 * the regulatory RAG system rather than computed from a flat rate here.
 */
function computeTaxWithholdingCents(grossPayCents) {
  const federal = Math.round(grossPayCents * PLACEHOLDER_CONFIG.flatFederalWithholdingRate);
  const state = Math.round(grossPayCents * PLACEHOLDER_CONFIG.flatStateWithholdingRate);
  return { federalCents: federal, stateCents: state, totalCents: federal + state };
}

/**
 * compute401kDeferralCents
 * -------------------------
 * The employee's elected deferral percentage, applied to gross pay, capped
 * so year-to-date deferrals never exceed the annual IRS limit. This is the
 * number that eventually gets reported to ReconciliationLedger.recordContribution
 * as "what payroll withheld."
 */
function compute401kDeferralCents(grossPayCents, employee, yearToDateDeferralCents = 0) {
  const electionPct = employee.deferralElectionPct || 0;
  if (electionPct < 0 || electionPct > 100) {
    throw new Error("deferralElectionPct must be between 0 and 100");
  }

  const requestedCents = Math.round(grossPayCents * (electionPct / 100));
  const remainingRoomCents = Math.max(
    0,
    PLACEHOLDER_CONFIG.annual401kElectiveDeferralLimitCents - yearToDateDeferralCents
  );

  const actualCents = Math.min(requestedCents, remainingRoomCents);
  const cappedByAnnualLimit = actualCents < requestedCents;

  return { requestedCents, actualCents, cappedByAnnualLimit };
}

/**
 * runPayrollForEmployee
 * -----------------------
 * Ties the pieces together into the one record this service cares about
 * producing correctly: what should get withheld and (eventually) handed to
 * the ReconciliationLedger as a ContributionRecord. This function does NOT
 * talk to the blockchain itself - see src/chain/contracts.js for that - so
 * it stays trivially unit-testable.
 */
function runPayrollForEmployee(employee, payPeriod, yearToDateDeferralCents = 0) {
  const grossPayCents = computeGrossPayCents(employee, payPeriod);
  const withholding = computeTaxWithholdingCents(grossPayCents);
  const deferral = compute401kDeferralCents(grossPayCents, employee, yearToDateDeferralCents);

  const netPayCents =
    grossPayCents - withholding.totalCents - deferral.actualCents;

  return {
    employeeId: employee.id,
    payPeriodId: payPeriod.id,
    grossPayCents,
    taxWithholding: withholding,
    contribution401k: deferral,
    netPayCents,
  };
}

module.exports = {
  PLACEHOLDER_CONFIG,
  computeGrossPayCents,
  computeTaxWithholdingCents,
  compute401kDeferralCents,
  runPayrollForEmployee,
};

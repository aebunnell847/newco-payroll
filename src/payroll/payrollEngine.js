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

const { annualDeferralCapCents, rothCatchUpRequired } = require("../regulatory/irsLimits");

/**
 * IMPORTANT: the tax withholding rates below are PLACEHOLDERS, not real
 * withholding. Federal/state/local withholding must come from the IRS
 * (Publication 15-T) and state sources via the regulatory RAG system
 * described in research/regulatory-rag-architecture.md, not a hardcoded
 * flat rate. Hardcoding them and shipping it would violate NewCo's "ground
 * everything in regulator source text" design goal.
 *
 * The 401(k) deferral limits are no longer placeholders: they come from
 * src/regulatory/irsLimits.js, a table copied from IRS notices with
 * citations, keyed by tax year.
 */
const PLACEHOLDER_CONFIG = {
  flatFederalWithholdingRate: 0.12, // NOT a real bracket calculation
  flatStateWithholdingRate: 0.05, // NOT a real state calculation
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
 * so year-to-date deferrals never exceed the IRS limit for the tax year
 * (see src/regulatory/irsLimits.js). This is the number that eventually
 * gets reported to ReconciliationLedger.recordContribution as "what
 * payroll withheld."
 *
 * options:
 *   taxYear            - required. The year the pay date falls in (that is
 *                        the year a deferral counts toward). There is no
 *                        default year on purpose.
 *   planAllowsCatchUp  - whether the plan offers catch-up contributions.
 *                        Defaults to false: deferring too little can be
 *                        fixed next period, an excess deferral needs a
 *                        corrective distribution.
 *
 * Catch-up eligibility uses employee.birthYear. Whether catch-up dollars
 * must be Roth (IRC 414(v)(7)) uses employee.priorYearFicaWagesCents and
 * is reported, not acted on: this engine doesn't split pre-tax and Roth.
 */
function compute401kDeferralCents(grossPayCents, employee, yearToDateDeferralCents = 0, options = {}) {
  const { taxYear, planAllowsCatchUp = false } = options;
  if (taxYear === undefined || taxYear === null) {
    throw new Error("taxYear is required to look up the IRS deferral limit");
  }

  const electionPct = employee.deferralElectionPct || 0;
  if (electionPct < 0 || electionPct > 100) {
    throw new Error("deferralElectionPct must be between 0 and 100");
  }

  const cap = annualDeferralCapCents({
    taxYear,
    birthYear: employee.birthYear,
    planAllowsCatchUp,
  });

  const requestedCents = Math.round(grossPayCents * (electionPct / 100));
  const remainingRoomCents = Math.max(0, cap.totalCents - yearToDateDeferralCents);

  const actualCents = Math.min(requestedCents, remainingRoomCents);
  const cappedByAnnualLimit = actualCents < requestedCents;

  // The part of this period's deferral that sits above the base 402(g)
  // limit, i.e. counts as catch-up.
  const catchUpPortionCents =
    Math.max(0, yearToDateDeferralCents + actualCents - cap.baseLimitCents) -
    Math.max(0, yearToDateDeferralCents - cap.baseLimitCents);

  return {
    requestedCents,
    actualCents,
    cappedByAnnualLimit,
    taxYear,
    annualLimitCents: cap.totalCents,
    catchUpBand: cap.catchUpBand,
    catchUpPortionCents,
    rothCatchUpRequired: rothCatchUpRequired({
      taxYear,
      catchUpPortionCents,
      priorYearFicaWagesCents: employee.priorYearFicaWagesCents,
    }),
  };
}

/**
 * runPayrollForEmployee
 * -----------------------
 * Ties the pieces together into the one record this service cares about
 * producing correctly: what should get withheld and (eventually) handed to
 * the ReconciliationLedger as a ContributionRecord. This function does NOT
 * talk to the blockchain itself - see src/chain/contracts.js for that - so
 * it stays trivially unit-testable.
 *
 * payPeriod.taxYear is required (see compute401kDeferralCents).
 * plan: { allowsCatchUp?: boolean } - plan-level features.
 */
function runPayrollForEmployee(employee, payPeriod, yearToDateDeferralCents = 0, plan = {}) {
  const grossPayCents = computeGrossPayCents(employee, payPeriod);
  const withholding = computeTaxWithholdingCents(grossPayCents);
  const deferral = compute401kDeferralCents(grossPayCents, employee, yearToDateDeferralCents, {
    taxYear: payPeriod.taxYear,
    planAllowsCatchUp: Boolean(plan.allowsCatchUp),
  });

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

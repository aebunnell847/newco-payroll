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
const { computeFederalWithholdingCents } = require("../regulatory/federalWithholding");
const { computeFicaCents } = require("../regulatory/fica");
const { computeStateWithholdingCents, SUPPORTED_STATES } = require("../regulatory/state");
const { reciprocityFor } = require("../regulatory/state/reciprocity");
const { getSupplementalRules, splitAtMillion, METHODS: SUPPLEMENTAL_METHODS } = require("../regulatory/supplemental");

/**
 * Every rate and limit used here is sourced, by tax year, in
 * src/regulatory/: 401(k) limits (irsLimits.js), federal income tax
 * withholding per IRS Publication 15-T (federalWithholding.js), Social
 * Security / Medicare (fica.js), and state withholding for the supported
 * states (state/). An unsupported state or year throws; nothing falls back
 * to a guessed rate.
 */

/**
 * computeGrossPayCents
 * ---------------------
 * Supports both salaried and hourly employees. Salaried: divide the annual
 * salary by how many pay periods occur in a year. Hourly: hours * rate,
 * plus 1.5x for anything over 40 hours in the period (a simplified
 * overtime rule - real overtime law varies by state and is itself a RAG
 * question, not a hardcoded 1.5x in every jurisdiction).
 */
/** Regular pay plus any supplemental pay (bonus, commission, ...) for the period. */
function computeGrossPayCents(employee, payPeriod) {
  const supplementalCents = payPeriod.supplementalCents ?? 0;
  if (!Number.isSafeInteger(supplementalCents) || supplementalCents < 0) {
    throw new Error("supplementalCents must be a non-negative integer number of cents");
  }
  return computeRegularPayCents(employee, payPeriod) + supplementalCents;
}

function computeRegularPayCents(employee, payPeriod) {
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
 * The part of a deferral that is pre-tax, i.e. excluded from federal
 * income-tax wages. All deferrals are treated as traditional (pre-tax)
 * except catch-up dollars that IRC 414(v)(7) requires to be Roth
 * (rothCatchUpRequired === true). When that answer is unknown (null) they
 * stay pre-tax and the null is surfaced for a person to resolve.
 */
function preTaxDeferralCents(deferral) {
  return deferral.actualCents - (deferral.rothCatchUpRequired === true ? deferral.catchUpPortionCents : 0);
}

/**
 * computeTaxWithholdingCents
 * ---------------------------
 *   federal - IRS Publication 15-T percentage method on income-tax wages
 *             (gross minus pre-tax deferrals) and the employee's Form W-4
 *   FICA    - Social Security (to the wage base) + Medicare + Additional
 *             Medicare, on gross pay (deferrals don't reduce FICA wages)
 *   state   - the work state's own method (regulatory/state/), on that
 *             state's wage basis (some exclude pre-tax 401(k), PA doesn't)
 *
 * w4: the employee's Form W-4 (see federalWithholding.js), or null if none
 * is on file - then the IRS default (Single, no adjustments) applies.
 * workState / stateW4: two-letter work state and that state's certificate
 * (DE 4, IL-W-4, ...), or null for none on file (each state's default).
 */
function computeTaxWithholdingCents({
  taxYear,
  grossPayCents,
  preTaxDeductionsCents = 0,
  payPeriodsPerYear,
  w4 = null,
  yearToDateFicaWagesCents = 0,
  workState,
  stateW4 = null,
  payDate = null,
  monthToDate = null,
  residenceState = null,
  residenceStateW4 = null,
  reciprocityCertificate = false,
  supplementalCents = 0,
  yearToDateSupplementalCents = 0,
  supplementalMethod = "aggregate",
}) {
  const federalTaxableWagesCents = grossPayCents - preTaxDeductionsCents;
  const federal = federalWithSupplemental({
    taxYear,
    grossPayCents,
    federalTaxableWagesCents,
    payPeriodsPerYear,
    w4,
    supplementalCents,
    yearToDateSupplementalCents,
    supplementalMethod,
  });
  const fica = computeFicaCents({ taxYear, ficaWagesCents: grossPayCents, yearToDateFicaWagesCents });
  const stateArgs = {
    taxYear,
    grossPayCents,
    federalTaxableWagesCents,
    payPeriodsPerYear,
    federalW4: w4,
    payDate,
    federalWithholdingCents: federal.federalCents,
    ficaCents: fica.totalCents,
    yearToDateFicaWagesCents,
    monthToDate,
  };
  let state = computeStateWithholdingCents({ ...stateArgs, state: workState, form: stateW4 });

  // Reciprocity: with the work state's nonresidence certificate on file, a
  // resident of a reciprocal state owes the work state no income tax; the
  // employer withholds the home state's tax instead. Work-state local taxes
  // (an Indiana county of principal employment, ...) still apply.
  let reciprocity = null;
  const agreement = reciprocityCertificate ? reciprocityFor(workState, residenceState) : null;
  if (reciprocityCertificate && !agreement) {
    throw new Error(
      `no reciprocity agreement covers a ${residenceState} resident working in ${workState}; clear reciprocityCertificate`
    );
  }
  if (agreement) {
    const homeSupported = SUPPORTED_STATES.includes(residenceState);
    const home = homeSupported
      ? computeStateWithholdingCents({ ...stateArgs, state: residenceState, form: residenceStateW4 })
      : null;
    const localities = { ...state.localities, ...(home ? home.localities : {}) };
    reciprocity = { workState, residenceState, certificate: agreement.certificate, homeStateWithheld: homeSupported };
    state = {
      state: residenceState,
      stateCents: home ? home.stateCents : 0,
      wagesCents: home ? home.wagesCents : 0,
      formBasis: home ? `reciprocity-${home.formBasis}` : "reciprocity-home-state-not-supported",
      localities,
      localCents: Object.values(localities).reduce((a, b) => a + b, 0),
    };
  }

  return {
    federalCents: federal.federalCents,
    federalSupplemental: federal.supplemental,
    federalTaxableWagesCents,
    federalWorksheet: federal.lines,
    w4Basis: federal.w4Basis,
    socialSecurityCents: fica.socialSecurityCents,
    medicareCents: fica.medicareCents,
    additionalMedicareCents: fica.additionalMedicareCents,
    ficaCents: fica.totalCents,
    stateCents: state.stateCents,
    state: state.state,
    stateWagesCents: state.wagesCents,
    stateFormBasis: state.formBasis,
    localities: state.localities,
    localCents: state.localCents,
    reciprocity,
    totalCents: federal.federalCents + fica.totalCents + state.stateCents + state.localCents,
  };
}

/**
 * Federal income tax with supplemental wages (Publication 15, section 7;
 * see regulatory/supplemental.js). The pre-tax deferral is shared between
 * regular and supplemental pay in proportion to each.
 */
function federalWithSupplemental({
  taxYear,
  grossPayCents,
  federalTaxableWagesCents,
  payPeriodsPerYear,
  w4,
  supplementalCents,
  yearToDateSupplementalCents,
  supplementalMethod,
}) {
  if (!supplementalCents) {
    return computeFederalWithholdingCents({ taxYear, taxableWagesCents: federalTaxableWagesCents, payPeriodsPerYear, w4 });
  }
  if (!SUPPLEMENTAL_METHODS.includes(supplementalMethod)) {
    throw new Error(`supplementalMethod must be one of ${SUPPLEMENTAL_METHODS.join(", ")}`);
  }
  const t = getSupplementalRules(taxYear);
  const supplementalTaxableCents = Math.round((federalTaxableWagesCents * supplementalCents) / grossPayCents);
  const regularTaxableCents = federalTaxableWagesCents - supplementalTaxableCents;
  const { mandatoryTaxableCents, ordinaryTaxableCents } = splitAtMillion(t, {
    supplementalTaxableCents,
    supplementalCents,
    yearToDateSupplementalCents,
  });
  const mandatoryCents = Math.round((mandatoryTaxableCents * t.mandatoryRateBp) / 10_000);
  const exempt = w4 && w4.exempt;
  let base;
  let flatCents = 0;
  if (supplementalMethod === "flat") {
    base = computeFederalWithholdingCents({ taxYear, taxableWagesCents: regularTaxableCents, payPeriodsPerYear, w4 });
    flatCents = exempt ? 0 : Math.round((ordinaryTaxableCents * t.flatRateBp) / 10_000);
  } else {
    base = computeFederalWithholdingCents({
      taxYear,
      taxableWagesCents: regularTaxableCents + ordinaryTaxableCents,
      payPeriodsPerYear,
      w4,
    });
  }
  return {
    ...base,
    federalCents: base.federalCents + flatCents + mandatoryCents,
    supplemental: {
      method: supplementalMethod,
      supplementalCents,
      supplementalTaxableCents,
      flatCents,
      mandatoryTaxableCents,
      mandatoryCents,
    },
  };
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
 *   maxCents           - optional extra cap (runPayrollForEmployee uses it
 *                        so a deferral never pushes net pay below zero).
 *
 * Catch-up eligibility uses employee.birthYear. Whether catch-up dollars
 * must be Roth (IRC 414(v)(7)) uses employee.priorYearFicaWagesCents; when
 * true, those dollars are taxed as Roth (see preTaxDeferralCents).
 */
function compute401kDeferralCents(grossPayCents, employee, yearToDateDeferralCents = 0, options = {}) {
  const { taxYear, planAllowsCatchUp = false, maxCents = Infinity } = options;
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

  const actualCents = Math.min(requestedCents, remainingRoomCents, maxCents);
  const cappedByAnnualLimit = remainingRoomCents < requestedCents;
  const cappedByNetPay = maxCents < Math.min(requestedCents, remainingRoomCents);

  // The part of this period's deferral that sits above the base 402(g)
  // limit, i.e. counts as catch-up.
  const catchUpPortionCents =
    Math.max(0, yearToDateDeferralCents + actualCents - cap.baseLimitCents) -
    Math.max(0, yearToDateDeferralCents - cap.baseLimitCents);

  return {
    requestedCents,
    actualCents,
    cappedByAnnualLimit,
    cappedByNetPay,
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
 * payPeriod.taxYear is required (see compute401kDeferralCents), and so is
 * employee.payPeriodsPerYear, for hourly employees too: withholding
 * annualizes each paycheck.
 * plan: { allowsCatchUp?: boolean } - plan-level features.
 * yearToDateFicaWagesCents: gross paid earlier this calendar year (for the
 * Social Security wage base and the Additional Medicare threshold).
 *
 * Taxes come first, then the 401(k): if the full deferral would leave
 * negative net pay, the deferral is reduced to what's left
 * (cappedByNetPay). If taxes alone exceed gross pay, this throws so a
 * person can review the employee's W-4 instead of issuing a negative check.
 */
function runPayrollForEmployee(
  employee,
  payPeriod,
  yearToDateDeferralCents = 0,
  plan = {},
  yearToDateFicaWagesCents = 0,
  monthToDate = null,
  yearToDateSupplementalCents = 0
) {
  const grossPayCents = computeGrossPayCents(employee, payPeriod);
  const taxYear = payPeriod.taxYear;
  const deferralOptions = { taxYear, planAllowsCatchUp: Boolean(plan.allowsCatchUp) };

  const deferralFor = (maxCents) =>
    compute401kDeferralCents(grossPayCents, employee, yearToDateDeferralCents, { ...deferralOptions, maxCents });
  const withholdingFor = (deferral) =>
    computeTaxWithholdingCents({
      taxYear,
      grossPayCents,
      preTaxDeductionsCents: preTaxDeferralCents(deferral),
      payPeriodsPerYear: employee.payPeriodsPerYear,
      w4: employee.w4 ?? null,
      yearToDateFicaWagesCents,
      workState: employee.workState,
      stateW4: employee.stateW4 ?? null,
      payDate: payPeriod.payDate ?? null,
      monthToDate,
      residenceState: employee.residenceState ?? null,
      residenceStateW4: employee.residenceStateW4 ?? null,
      reciprocityCertificate: Boolean(employee.reciprocityCertificate),
      supplementalCents: payPeriod.supplementalCents ?? 0,
      yearToDateSupplementalCents,
      supplementalMethod: plan.supplementalMethod ?? "aggregate",
    });
  const netFor = (deferral, withholding) => grossPayCents - withholding.totalCents - deferral.actualCents;

  let deferral = deferralFor(Infinity);
  let withholding = withholdingFor(deferral);

  if (netFor(deferral, withholding) < 0) {
    // Net pay rises as the deferral shrinks (each deferred dollar costs
    // less than a dollar of net pay), so binary-search the largest
    // deferral that leaves net pay at or above zero.
    const zero = deferralFor(0);
    if (netFor(zero, withholdingFor(zero)) < 0) {
      throw new Error("taxes withheld would exceed gross pay; review this employee's Form W-4");
    }
    let lo = 0;
    let hi = deferral.actualCents;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      const d = deferralFor(mid);
      if (netFor(d, withholdingFor(d)) >= 0) lo = mid;
      else hi = mid;
    }
    deferral = deferralFor(lo);
    withholding = withholdingFor(deferral);
  }

  return {
    employeeId: employee.id,
    payPeriodId: payPeriod.id,
    grossPayCents,
    supplementalCents: payPeriod.supplementalCents ?? 0,
    taxWithholding: withholding,
    contribution401k: deferral,
    netPayCents: netFor(deferral, withholding),
  };
}

module.exports = {
  computeGrossPayCents,
  computeTaxWithholdingCents,
  compute401kDeferralCents,
  preTaxDeferralCents,
  runPayrollForEmployee,
};

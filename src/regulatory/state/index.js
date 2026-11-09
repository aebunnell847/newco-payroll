// SPDX-License-Identifier: MIT
//
// Plain-English overview: state income tax withholding. Each supported
// state lives in its own file with its own cited sources and tax years;
// this file picks the right one and hands it the right wages.
//
// Withholding follows the employee's WORK state (employee.workState).
// Local taxes are included where the state's own certificate carries them
// (New York City and Yonkers residency on NY's IT-2104, Indiana county on
// the WH-4) and returned
// separately as `localities`, since they're reported separately on the W-2.
// Resident-state credits, reciprocity agreements between states, and other
// local taxes are not modeled yet.
//
// A state or year with no sourced method throws, the same as the federal
// tables: payroll never falls back to a guessed rate.
//
// Wage basis differs by state, which is why each module declares it:
//   "federal-income-tax-wages" - gross minus pre-tax 401(k) (most states)
//   "gross"                    - 401(k) deferrals are taxed (PA)
//   "none"                     - no state income tax (see noIncomeTax.js)

const MODULES = [
  require("./az"),
  require("./ca"),
  require("./co"),
  require("./ga"),
  require("./ia"),
  require("./id"),
  require("./il"),
  require("./in"),
  require("./ky"),
  require("./la"),
  require("./mi"),
  require("./mo"),
  require("./ms"),
  require("./nc"),
  require("./nd"),
  require("./nj"),
  require("./ny"),
  require("./ok"),
  require("./pa"),
  require("./sc"),
  require("./ut"),
  require("./va"),
  ...require("./noIncomeTax"),
];
const BY_CODE = Object.freeze(Object.fromEntries(MODULES.map((m) => [m.code, m])));

function getStateModule(code, taxYear) {
  const m = BY_CODE[code];
  if (!m) {
    throw new Error(
      `no sourced withholding method for state "${code}" (have: ${Object.keys(BY_CODE).sort().join(", ")})`
    );
  }
  if (taxYear !== undefined && !m.years.includes(taxYear)) {
    throw new Error(`no sourced ${m.name} withholding for tax year ${taxYear} (have: ${m.years.join(", ")})`);
  }
  return m;
}

/** Validate an employee's state withholding form for their work state. */
function validateStateForm(code, form) {
  getStateModule(code).validateForm(form);
}

/**
 * computeStateWithholdingCents
 *   state                      - two-letter work state, e.g. "CA"
 *   grossPayCents              - this period's gross pay
 *   federalTaxableWagesCents   - gross minus pre-tax deferrals
 *   payPeriodsPerYear, taxYear
 *   form                       - the state's withholding certificate
 *                                (DE 4, IL-W-4, IT-2104, ...) or null if none on file
 *   federalW4                  - the federal W-4, for states whose no-certificate
 *                                default refers to it (NY, for 2019-or-earlier forms)
 *   payDate                    - "YYYY-MM-DD"; needed by states whose figures
 *                                changed mid-year (GA, ID in 2026)
 *
 * Returns stateCents (the state's own tax) and localities / localCents
 * (city taxes the state certificate covers), kept apart for W-2 reporting.
 */
function computeStateWithholdingCents({
  state,
  taxYear,
  grossPayCents,
  federalTaxableWagesCents,
  payPeriodsPerYear,
  form = null,
  federalW4 = null,
  payDate = null,
}) {
  if (typeof state !== "string" || !state) {
    throw new Error("no work state on file; state withholding needs employee.workState (e.g. \"CA\")");
  }
  const m = getStateModule(state, taxYear);
  const wagesCents =
    m.wageBasis === "gross" ? grossPayCents : m.wageBasis === "none" ? 0 : federalTaxableWagesCents;
  const out = m.compute({ taxYear, wagesCents, payPeriodsPerYear, form, federalW4, payDate });
  const localities = out.localities || {};
  const localCents = Object.values(localities).reduce((a, b) => a + b, 0);
  return { state: m.code, wageBasis: m.wageBasis, wagesCents, ...out, localities, localCents };
}

module.exports = {
  SUPPORTED_STATES: Object.keys(BY_CODE).sort(),
  getStateModule,
  validateStateForm,
  computeStateWithholdingCents,
};

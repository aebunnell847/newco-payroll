// SPDX-License-Identifier: MIT
//
// Utah income tax withholding: Publication 14, Withholding Tax Guide
// (Rev. 4/26), "Utah Withholding Schedules", effective for pay periods
// beginning on or after June 1, 2026:
//   2. wages x 4.45%
//   3. base allowance (per schedule and status)
//   4. wages - threshold (not less than 0)
//   5. line 4 x 1.3%
//   6. line 3 - line 5 (not less than 0)
//   7. line 2 - line 6 (not less than 0) = withholding
// Lines are whole dollars, as in the Pub's six worked examples (all six are
// in the tests). The schedule figures are printed per pay period; they're
// encoded below from Schedules 1-8.
//
// Effective date: the Pub keys on the pay PERIOD start; payroll here keys
// on the pay date, so a pay date on or after 2026-06-01 is treated as in
// scope and anything earlier throws (the earlier 2026 schedules aren't
// sourced here). A period that starts in May and pays in June should be
// reviewed by hand.
//
// Utah has no state withholding certificate: "Withhold amounts based on
// your employee's federal W-4 form" - single or married per the federal
// W-4's filing status. Married filing jointly uses the married schedule;
// single and head of household use the single schedule (the schedules
// have only those two columns). A pre-2020 W-4 marked married uses the
// married schedule. No federal W-4: single.
// stateW4 is only for Utah's two exclusions written on the W-4 ("Utah Only
// - Exempt, Interstate Transportation" / "... Military Spouse"):
//   { exempt: "interstateTransportation" | "militarySpouse" }.
//
// Wages: "Utah calculates withholding tax based on wages subject to
// federal withholding tax" (IRC 3401(a)), so pre-tax 401(k) is excluded.

const { formChecker, onFile, requirePayDateFrom, PERIOD_BY_COUNT } = require("./formUtil");

// [baseAllowanceDollars, thresholdDollars] per schedule, from Pub 14.
const SCHEDULES = Object.freeze({
  weekly: Object.freeze({ single: [9, 180], married: [19, 360] }),
  biweekly: Object.freeze({ single: [19, 360], married: [37, 719] }),
  semimonthly: Object.freeze({ single: [20, 390], married: [40, 779] }),
  monthly: Object.freeze({ single: [40, 779], married: [81, 1_558] }),
  quarterly: Object.freeze({ single: [121, 2_337], married: [243, 4_674] }),
  semiannual: Object.freeze({ single: [243, 4_674], married: [485, 9_348] }),
  annual: Object.freeze({ single: [485, 9_348], married: [970, 18_696] }),
  daily: Object.freeze({ single: [2, 36], married: [4, 72] }),
});

const TABLES = Object.freeze({
  2026: Object.freeze({
    effectiveFrom: "2026-06-01",
    rateBp: 445,
    phaseOutBp: 130,
    schedules: SCHEDULES,
    sources: Object.freeze([
      "Utah State Tax Commission, Publication 14 Withholding Tax Guide (Rev. 4/26, effective June 1, 2026): https://files.tax.utah.gov/tax/forms/pubs/pub-14.pdf",
    ]),
  }),
});

function validateForm(form) {
  if (!onFile(form)) return;
  const c = formChecker("Utah (federal W-4 note)");
  c.oneOf(form, "exempt", ["interstateTransportation", "militarySpouse"]);
}

const dollars = (cents) => Math.round(cents / 100);

function compute({ taxYear, wagesCents, payPeriodsPerYear, form, federalW4 = null, payDate }) {
  const t = TABLES[taxYear];
  requirePayDateFrom(payDate, t.effectiveFrom, "Utah");
  validateForm(form);
  if (onFile(form)) return { stateCents: 0, formBasis: `utah-exempt-${form.exempt}`, lines: {} };
  const period = PERIOD_BY_COUNT[payPeriodsPerYear];
  if (!period) throw new Error(`Utah has no withholding schedule for ${payPeriodsPerYear} pay periods a year`);
  const married = Boolean(
    federalW4 &&
      (federalW4.formYear >= 2020 ? federalW4.filingStatus === "marriedFilingJointly" : federalW4.maritalStatus === "married")
  );
  const [base, threshold] = t.schedules[period][married ? "married" : "single"];
  const line2 = dollars((wagesCents * t.rateBp) / 10_000);
  const line4 = Math.max(0, wagesCents - threshold * 100);
  const line5 = dollars((line4 * t.phaseOutBp) / 10_000);
  const line6 = Math.max(0, base - line5);
  const line7 = Math.max(0, line2 - line6);
  return {
    stateCents: line7 * 100,
    formBasis: federalW4 ? "federal-w4" : "none-on-file-single",
    lines: { schedule: period, status: married ? "married" : "single", line2, line3: base, line4Cents: line4, line5, line6, line7 },
  };
}

module.exports = {
  code: "UT",
  name: "Utah",
  wageBasis: "federal-income-tax-wages",
  years: Object.keys(TABLES).map(Number),
  TABLES,
  validateForm,
  compute,
};

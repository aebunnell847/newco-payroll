// SPDX-License-Identifier: MIT
//
// Louisiana income tax withholding: R-1306 (1/26), "Louisiana Withholding
// Tables and Formulas", Computer Formula Method, effective Jan. 1, 2026:
//   no deduction:              W = S x 3.09%
//   single / married separate: W = (S - $12,875 / N) x 3.09%
//   joint / surviving / HoH:   W = (S - $25,750 / N) x 3.09%
// "if any of the variables in the formula are negative, the negative
// variable should be considered zero". 3.09% is the 3% flat rate plus a
// cushion the Department builds into withholding. N for daily payroll is
// 365, per the R-1306 pay-period list. Both R-1306 examples are in the
// tests.
//
// L-4 (R-1300) input: { deductions: 0 | 1 | 2, adjustmentCents? } - line 7
// may be negative but "cannot result in an amount less than zero".
// No L-4 on file: "the employer must withhold Louisiana income tax from
// the employee's wages without any standard deduction" (L-4).
//
// Wages: federal income-tax wages. Louisiana tax starts from federal
// adjusted gross income, which excludes pre-tax 401(k) deferrals; the
// R-1306 and the Department's withholding FAQ don't address 401(k)
// directly.

const { formChecker, onFile } = require("./formUtil");

const TABLES = Object.freeze({
  2025: Object.freeze({
    withholdingRateBp: 309,
    standardDeductionCents: Object.freeze({ 1: 12_500_00, 2: 25_000_00 }),
    sources: Object.freeze([
      "Louisiana DOR, R-1306 (1/25) Louisiana Withholding Tables and Formulas, effective on or after January 1, 2025: https://dam.ldr.la.gov/taxforms/1306-1-25.pdf",
    ]),
  }),
  2026: Object.freeze({
    withholdingRateBp: 309,
    standardDeductionCents: Object.freeze({ 1: 12_875_00, 2: 25_750_00 }),
    sources: Object.freeze([
      "Louisiana DOR, R-1306 (1/26) Louisiana Withholding Tables and Formulas: https://dam.ldr.la.gov/taxforms/1306-1-26.pdf",
      "Louisiana DOR, R-1300 (1/26) Employee's Withholding Certificate (L-4): https://dam.ldr.la.gov/taxforms/1300-1-26-F.pdf",
    ]),
  }),
});

function validateForm(form) {
  if (!onFile(form)) return;
  const c = formChecker("Louisiana L-4");
  c.oneOf(form, "deductions", [0, 1, 2]);
  const adj = form.adjustmentCents ?? 0;
  if (!Number.isSafeInteger(adj)) c.fail("adjustmentCents must be an integer number of cents (negative to decrease)");
}

function compute({ taxYear, wagesCents, payPeriodsPerYear, form }) {
  const t = TABLES[taxYear];
  validateForm(form);
  const has = onFile(form);
  const deductions = has ? form.deductions : 0;
  const N = payPeriodsPerYear === 260 ? 365 : payPeriodsPerYear;
  const perPeriodDeduction = deductions === 0 ? 0 : t.standardDeductionCents[deductions] / N;
  const W = (Math.max(0, wagesCents - perPeriodDeduction) * t.withholdingRateBp) / 10_000;
  const adjusted = Math.max(0, Math.round(W) + (has ? form.adjustmentCents ?? 0 : 0));
  return {
    stateCents: adjusted,
    formBasis: has ? "l-4" : "none-on-file-no-deduction",
    lines: { N, perPeriodDeductionCents: perPeriodDeduction },
  };
}

module.exports = {
  code: "LA",
  name: "Louisiana",
  wageBasis: "federal-income-tax-wages",
  years: Object.keys(TABLES).map(Number),
  TABLES,
  validateForm,
  compute,
};

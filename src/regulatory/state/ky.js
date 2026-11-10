// SPDX-License-Identifier: MIT
//
// Kentucky income tax withholding: the Department of Revenue's
// "Withholding Tax Formula" (42A003 (TCF)):
//   annual wages = wages x pay periods
//   tax = (annual wages - standard deduction) x flat rate / pay periods
//
// Kentucky's withholding certificate (K-4) has no allowances: it carries an
// exemption claim and an additional-withholding amount, so that's all this
// reads. No K-4 on file: withhold by the formula with no extra amount.
//
// Wages: federal income-tax wages. Per the 42A003 employer instructions,
// "wages ... mean the same as defined in Section 3401 of the Internal
// Revenue Code", and their quick-reference chart lists "Retirement and
// Pension Plans (401K Plan)" as not subject to Kentucky withholding.
//
// Not covered: Kentucky's local occupational license taxes (city / county),
// which are separate filings with each locality.
//
// About the 42A003 examples: the monthly one matches to the cent. The
// biweekly one prints "$1,247.40 / 26 = $47"; $1,247.40 / 26 is $47.98, so
// the Department appears to have truncated to whole dollars there. This
// code keeps the cent.

const { formChecker, onFile } = require("./formUtil");

const TABLES = Object.freeze({
  2025: Object.freeze({
    standardDeductionCents: 3_270_00,
    rateBp: 400,
    sources: Object.freeze([
      "KY DOR, 2025 Kentucky Withholding Tax Formula 42A003 (TCF)(12-2024): https://revenue.ky.gov/Forms/Withholding%20Computer%20Formula.pdf",
      "KY DOR, 2025 42A003(T)(12-24) Withholding Tax Tables: https://revenue.ky.gov/Documents/2025_42A003(T)(12-24)-%20WH%20Tax%20Tables.pdf",
    ]),
  }),
  2026: Object.freeze({
    standardDeductionCents: 3_360_00,
    rateBp: 350,
    sources: Object.freeze([
      "KY DOR, 2026 Kentucky Withholding Tax Formula 42A003 (TCF)(10-2025): https://revenue.ky.gov/Forms/2026%20Withholding%20Formula.pdf",
      "KY DOR, Withholding Kentucky Income Tax Instructions for Employers (Mar. 2026): https://revenue.ky.gov/Forms/42A003-March%202026.pdf",
      "KY DOR, 2026 K-4: https://revenue.ky.gov/Forms/42A804%20(K-4)%20(2026).pdf",
    ]),
  }),
});

function validateForm(form) {
  if (!onFile(form)) return;
  const c = formChecker("Kentucky K-4");
  c.bool(form, "exempt");
  c.cents(form, "additionalWithholdingCents");
}

function compute({ taxYear, wagesCents, payPeriodsPerYear, form }) {
  const t = TABLES[taxYear];
  validateForm(form);
  if (onFile(form) && form.exempt) return { stateCents: 0, formBasis: "k-4-exempt", lines: {} };
  const annual = wagesCents * payPeriodsPerYear;
  const taxableAnnual = Math.max(0, annual - t.standardDeductionCents);
  const annualTax = (taxableAnnual * t.rateBp) / 10_000;
  const extra = onFile(form) ? form.additionalWithholdingCents ?? 0 : 0;
  return {
    stateCents: Math.round(annualTax / payPeriodsPerYear) + extra,
    formBasis: onFile(form) ? "k-4" : "none-on-file",
    lines: { annualWagesCents: annual, taxableAnnualCents: taxableAnnual, annualTaxCents: annualTax },
  };
}

module.exports = {
  code: "KY",
  name: "Kentucky",
  wageBasis: "federal-income-tax-wages",
  years: Object.keys(TABLES).map(Number),
  TABLES,
  validateForm,
  compute,
};

// SPDX-License-Identifier: MIT
//
// Virginia income tax withholding: "Withholding Tables for Wages Paid after
// July 1, 2025", Formula for Computing Tax to be Withheld:
//   T = G x P - [$8,750 + E1 x $930 + E2 x $800]
//   W = 2% to $3,000; $60 + 3% to $5,000; $120 + 5% to $17,000;
//       $720 + 5.75% over $17,000
//   W/H = W / P
// P for daily payroll is 300 (the Department's Pay Period Conversion
// Table). The Department's example rounds W to whole dollars ($2,628)
// before dividing; this does the same, and matches it ($109.50).
//
// The $8,750 standard deduction is "scheduled to sunset after Taxable Year
// 2026" (back to $3,000 single), so this table is 2026 only.
//
// VA-4 input: { personalExemptions (E1: self, spouse, dependents),
//   ageBlindExemptions (E2), additionalWithholdingCents?, exempt? }.
// "You may not substitute federal certificates (Forms W-4 or W-4P)."
// No VA-4 on file: "withhold Virginia income tax as if no exemptions had
// been claimed" (Income Tax Withholding Guide for Employers).
//
// Wages: "Payments that are exempt from federal withholding are also
// exempt from Virginia withholding" (Guide), so pre-tax 401(k) is excluded.

const { formChecker, onFile } = require("./formUtil");
const { fromBaseTable } = require("./brackets");

const TABLES = Object.freeze({
  2026: Object.freeze({
    standardDeductionCents: 8_750_00,
    personalExemptionCents: 930_00,
    ageBlindExemptionCents: 800_00,
    dailyPeriods: 300,
    annualTable: Object.freeze([
      [0, 0, 200],
      [3_000_00, 60_00, 300],
      [5_000_00, 120_00, 500],
      [17_000_00, 720_00, 575],
    ]),
    sources: Object.freeze([
      "Virginia Tax, Withholding Tables for Wages Paid after July 1, 2025: https://www.tax.virginia.gov/sites/default/files/taxforms/withholding/any/employer-withholding-tables-july-2025-and-later-any.pdf",
      "Virginia Tax, Income Tax Withholding Guide for Employers: https://www.tax.virginia.gov/sites/default/files/vatax-pdf/employer-withholding-instructions.pdf",
      "Virginia Tax, Form VA-4: https://www.tax.virginia.gov/sites/default/files/taxforms/withholding/any/va-4-any.pdf",
    ]),
  }),
});

function validateForm(form) {
  if (!onFile(form)) return;
  const c = formChecker("Virginia VA-4");
  c.nonNegInt(form, "personalExemptions");
  c.nonNegInt(form, "ageBlindExemptions");
  c.cents(form, "additionalWithholdingCents");
  c.bool(form, "exempt");
}

function compute({ taxYear, wagesCents, payPeriodsPerYear, form }) {
  const t = TABLES[taxYear];
  validateForm(form);
  const has = onFile(form);
  if (has && form.exempt) return { stateCents: 0, formBasis: "va-4-exempt", lines: {} };
  const P = payPeriodsPerYear === 260 ? t.dailyPeriods : payPeriodsPerYear;
  const E1 = has ? form.personalExemptions ?? 0 : 0;
  const E2 = has ? form.ageBlindExemptions ?? 0 : 0;
  const T = Math.max(0, wagesCents * P - (t.standardDeductionCents + E1 * t.personalExemptionCents + E2 * t.ageBlindExemptionCents));
  const W = Math.round(fromBaseTable(T, t.annualTable) / 100) * 100;
  const extra = has ? form.additionalWithholdingCents ?? 0 : 0;
  return {
    stateCents: Math.round(W / P) + extra,
    formBasis: has ? "va-4" : "none-on-file-no-exemptions",
    lines: { P, T, W },
  };
}

module.exports = {
  code: "VA",
  name: "Virginia",
  wageBasis: "federal-income-tax-wages",
  years: Object.keys(TABLES).map(Number),
  TABLES,
  validateForm,
  compute,
};

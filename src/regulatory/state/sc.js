// SPDX-License-Identifier: MIT
//
// South Carolina income tax withholding: WH-1603F (Rev. 11/4/25), "Formula
// for Computing South Carolina 2026 Withholding Tax":
//   annual wages - $5,000 per allowance
//                - standard deduction: 10% of annual wages, up to $7,500,
//                  only if one or more allowances are claimed
//   tax: 0% to $3,640; 3% to $18,230; 6% over, plus $437.70
//   divide by the pay periods
// The WH-1603F example ($750 weekly, 3 allowances -> $549.90 a year,
// $10.58 a week) is in the tests.
//
// SC W-4 input: { allowances, additionalWithholdingCents?, exempt? }.
// No SC W-4 on file: "you must withhold at the rate of zero allowances if
// no SC W-4 is provided" (WH-1603 / WH-105, employees hired after 2019).
//
// Wages: federal income-tax wages. South Carolina taxable income starts
// from federal taxable income, which excludes pre-tax 401(k) deferrals;
// the WH-1603F doesn't address 401(k) directly.

const { formChecker, onFile } = require("./formUtil");
const { fromBaseTable } = require("./brackets");

const TABLES = Object.freeze({
  2025: Object.freeze({
    allowanceCents: 4_860_00,
    standardDeductionRateBp: 1_000,
    standardDeductionCapCents: 7_300_00,
    annualTable: Object.freeze([
      [0, 0, 0],
      [3_560_00, 0, 300],
      [17_830_00, 428_10, 620],
    ]),
    sources: Object.freeze([
      "SC DOR, WH-1603F (Rev. 11/12/24) Formula for Computing South Carolina 2025 Withholding Tax: https://dor.sc.gov/sites/dor/files/forms/WH1603F_2025.pdf",
    ]),
  }),
  2026: Object.freeze({
    allowanceCents: 5_000_00,
    standardDeductionRateBp: 1_000,
    standardDeductionCapCents: 7_500_00,
    annualTable: Object.freeze([
      [0, 0, 0],
      [3_640_00, 0, 300],
      [18_230_00, 437_70, 600],
    ]),
    sources: Object.freeze([
      "SCDOR, WH-1603F Formula for Computing South Carolina 2026 Withholding Tax (Rev. 11/4/25): https://dor.sc.gov/sites/dor/files/forms/WH1603F_2026.pdf",
      "SCDOR, WH-1603 2026 Withholding Tax Tables (Rev. 10/30/25): https://dor.sc.gov/sites/dor/files/forms/WH1603_2026.pdf",
      "SCDOR, 2026 SC W-4: https://dor.sc.gov/sites/dor/files/forms/SCW4_2026.pdf",
    ]),
  }),
});

function validateForm(form) {
  if (!onFile(form)) return;
  const c = formChecker("South Carolina SC W-4");
  c.nonNegInt(form, "allowances");
  c.cents(form, "additionalWithholdingCents");
  c.bool(form, "exempt");
}

function compute({ taxYear, wagesCents, payPeriodsPerYear, form }) {
  const t = TABLES[taxYear];
  validateForm(form);
  const has = onFile(form);
  if (has && form.exempt) return { stateCents: 0, formBasis: "sc-w-4-exempt", lines: {} };
  const allowances = has ? form.allowances ?? 0 : 0;
  const annual = wagesCents * payPeriodsPerYear;
  const standardDeduction =
    allowances > 0 ? Math.min(t.standardDeductionCapCents, Math.round((annual * t.standardDeductionRateBp) / 10_000)) : 0;
  const taxable = Math.max(0, annual - allowances * t.allowanceCents - standardDeduction);
  const annualTax = fromBaseTable(taxable, t.annualTable);
  const extra = has ? form.additionalWithholdingCents ?? 0 : 0;
  return {
    stateCents: Math.round(annualTax / payPeriodsPerYear) + extra,
    formBasis: has ? "sc-w-4" : "none-on-file-zero-allowances",
    lines: { taxableAnnualCents: taxable, standardDeductionCents: standardDeduction, annualTaxCents: annualTax },
  };
}

module.exports = {
  code: "SC",
  name: "South Carolina",
  wageBasis: "federal-income-tax-wages",
  years: Object.keys(TABLES).map(Number),
  TABLES,
  validateForm,
  compute,
};

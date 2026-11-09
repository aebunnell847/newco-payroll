// SPDX-License-Identifier: MIT
//
// Missouri income tax withholding: "2026 Missouri Withholding Tax Formula"
// (revised 11/21/2025):
//   annual wage - standard deduction = Missouri taxable income
//   apply the annual rate table, "Begin at the lowest rate and accumulate"
//   divide by the pay periods; "round ... to the nearest whole dollar"
// The Department's worked example rounds each full bracket's tax to whole
// dollars ($1,348 x 2.0% = $27.00, ... = $263.00 through 4.5%) before
// adding the top bracket's exact amount; this does the same, so the example
// ($35,000 a year, married spouse works -> $707.81 a year, $59 a month)
// matches exactly.
//
// MO W-4 input: { filingStatus: "single" | "marriedSpouseDoesNotWork" |
//   "headOfHousehold", additionalWithholdingCents?, reducedWithholdingCents?,
//   exempt? }. Line 1's first box covers single, married spouse works and
//   married filing separately (all $16,100). Line 3 ("reduced withholding")
//   replaces the standard calculation with the amount the employee entered.
// No MO W-4 on file: "withhold at a single tax rate" (Form 4282, Employer's
// Tax Guide).
//
// Wages: the formula refers to federal Publication 15 for gross taxable
// income, so pre-tax 401(k) is excluded.

const { formChecker, onFile } = require("./formUtil");

const TABLES = Object.freeze({
  2026: Object.freeze({
    standardDeductionCents: Object.freeze({
      single: 16_100_00,
      marriedSpouseDoesNotWork: 32_200_00,
      headOfHousehold: 24_150_00,
    }),
    // Annual payroll period table: [overCents, rateBp].
    annualRates: Object.freeze([
      [0, 0],
      [1_348_00, 200],
      [2_696_00, 250],
      [4_044_00, 300],
      [5_392_00, 350],
      [6_740_00, 400],
      [8_088_00, 450],
      [9_436_00, 470],
    ]),
    sources: Object.freeze([
      "MO DOR, 2026 Missouri Withholding Tax Formula: https://dor.mo.gov/forms/Withholding%20Formula_2026.pdf",
      "MO DOR, Employer's Tax Guide Form 4282 (Rev. 03-2026): https://dor.mo.gov/forms/4282_2026.pdf",
      "MO DOR, Form MO W-4: https://dor.mo.gov/forms/MO%20W-4.pdf",
    ]),
  }),
});

function annualTaxCents(taxableCents, rates) {
  let tax = 0;
  for (let i = 0; i < rates.length; i++) {
    const [lo, rateBp] = rates[i];
    const hi = i + 1 < rates.length ? rates[i + 1][0] : Infinity;
    if (taxableCents <= lo) break;
    const slice = ((Math.min(taxableCents, hi) - lo) * rateBp) / 10_000;
    // Full brackets rounded to whole dollars, as in the Department's example.
    tax += taxableCents >= hi ? Math.round(slice / 100) * 100 : slice;
  }
  return tax;
}

function validateForm(form) {
  if (!onFile(form)) return;
  const c = formChecker("Missouri MO W-4");
  c.bool(form, "exempt");
  if (form.exempt) return;
  c.oneOf(form, "filingStatus", ["single", "marriedSpouseDoesNotWork", "headOfHousehold"]);
  c.cents(form, "additionalWithholdingCents");
  if (form.reducedWithholdingCents !== undefined && form.reducedWithholdingCents !== null) {
    c.cents(form, "reducedWithholdingCents");
  }
}

function compute({ taxYear, wagesCents, payPeriodsPerYear, form }) {
  const t = TABLES[taxYear];
  validateForm(form);
  const has = onFile(form);
  if (has && form.exempt) return { stateCents: 0, formBasis: "mo-w-4-exempt", lines: {} };
  if (has && form.reducedWithholdingCents !== undefined && form.reducedWithholdingCents !== null) {
    return { stateCents: form.reducedWithholdingCents, formBasis: "mo-w-4-line-3-reduced", lines: {} };
  }
  const status = has ? form.filingStatus : "single";
  const taxable = Math.max(0, wagesCents * payPeriodsPerYear - t.standardDeductionCents[status]);
  const annualTax = annualTaxCents(taxable, t.annualRates);
  const extra = has ? form.additionalWithholdingCents ?? 0 : 0;
  return {
    stateCents: Math.round(annualTax / payPeriodsPerYear / 100) * 100 + extra,
    formBasis: has ? "mo-w-4" : "none-on-file-single",
    lines: { taxableAnnualCents: taxable, annualTaxCents: annualTax },
  };
}

module.exports = {
  code: "MO",
  name: "Missouri",
  wageBasis: "federal-income-tax-wages",
  years: Object.keys(TABLES).map(Number),
  TABLES,
  validateForm,
  compute,
};

// SPDX-License-Identifier: MIT
//
// North Carolina income tax withholding: NC-30 (2026), "Annualized Method -
// Formula Tables" (page 19):
//   net = wages x periods - N.C. standard deduction - allowances x $2,500
//   tax per period = net x 4.09% / periods, rounded to the nearest dollar
// 4.09% is the 3.99% 2026 income tax rate plus 0.1%, as NC-30 prescribes.
//
// NC-4 input: { filingStatus: single|married|surviving|headOfHousehold,
//   allowances, additionalWithholdingCents?, exempt? }.
// Standard deduction: $12,750 single / married / surviving spouse, $19,125
// head of household (NC-30's per-period figures, e.g. $245.19 and $367.79
// weekly, are these divided by 52).
// No NC-4 on file: "withhold ... as if the employee is single with no
// allowances" (NC-30).
//
// Wages: "The term wages has the same meaning as in section 3401 of the
// Internal Revenue Code" (NC-30 Section 9), so pre-tax 401(k) is excluded.

const { formChecker, onFile } = require("./formUtil");

const STATUSES = ["single", "married", "surviving", "headOfHousehold"];

const TABLES = Object.freeze({
  2026: Object.freeze({
    withholdingRateBp: 409,
    allowanceCents: 2_500_00,
    standardDeductionCents: Object.freeze({ standard: 12_750_00, headOfHousehold: 19_125_00 }),
    sources: Object.freeze([
      "NCDOR, NC-30 2026 Income Tax Withholding Tables and Instructions for Employers: https://www.ncdor.gov/income-tax-withholding-tables-and-instructions-employers/open",
    ]),
  }),
});

function validateForm(form) {
  if (!onFile(form)) return;
  const c = formChecker("North Carolina NC-4");
  c.oneOf(form, "filingStatus", STATUSES);
  c.nonNegInt(form, "allowances");
  c.cents(form, "additionalWithholdingCents");
  c.bool(form, "exempt");
}

function compute({ taxYear, wagesCents, payPeriodsPerYear, form }) {
  const t = TABLES[taxYear];
  validateForm(form);
  const has = onFile(form);
  if (has && form.exempt) return { stateCents: 0, formBasis: "nc-4-exempt", lines: {} };
  const status = has ? form.filingStatus : "single";
  const allowances = has ? form.allowances ?? 0 : 0;
  const deduction = t.standardDeductionCents[status === "headOfHousehold" ? "headOfHousehold" : "standard"];
  const annual = wagesCents * payPeriodsPerYear;
  const net = Math.max(0, annual - deduction - allowances * t.allowanceCents);
  const perPeriod = (net * t.withholdingRateBp) / 10_000 / payPeriodsPerYear;
  const extra = has ? form.additionalWithholdingCents ?? 0 : 0;
  return {
    stateCents: Math.round(perPeriod / 100) * 100 + extra,
    formBasis: has ? "nc-4" : "none-on-file-single-zero",
    lines: { annualWagesCents: annual, standardDeductionCents: deduction, netAnnualCents: net },
  };
}

module.exports = {
  code: "NC",
  name: "North Carolina",
  wageBasis: "federal-income-tax-wages",
  years: Object.keys(TABLES).map(Number),
  TABLES,
  validateForm,
  compute,
};

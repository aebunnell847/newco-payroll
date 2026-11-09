// SPDX-License-Identifier: MIT
//
// Mississippi income tax withholding: Pub 89-700 (Rev. 07/25, revised
// 1/13/2026), "Withholding Income Tax Tables and Employer Instructions",
// tax year 2026: 0% on the first $10,000 of taxable income, 4.0% on the
// rest.
//
// Method: the Pub's annualized computation (Section 17): annualize the
// period's wages, subtract the exemption claimed on Form 89-350 and the
// standard deduction, compute the tax, divide by the pay periods, and round
// to the nearest whole dollar. The Pub prescribes this for exemptions
// beyond the printed tables; the printed wage-bracket tables are built the
// same way, and the tests cross-check rows of the 2026 biweekly single
// table to the dollar.
//
// Standard deduction by table: $2,300 single (Table A), $3,400 head of
// family (Table B), $4,600 married, spouse not employed (Table C), $2,300
// married, both employed (Table D: the joint deduction split equally).
//
// 89-350 input: { status: "single" | "headOfFamily" |
//   "marriedSpouseNotEmployed" | "marriedBothEmployed", exemptionCents,
//   additionalWithholdingCents? }  (the exemption is a dollar amount the
//   employee enters, e.g. $6,000 single, $12,000 married).
// No 89-350 on file: "withhold based on zero exemption" (Pub, Section 12),
// on the single table.
//
// Wages: federal income-tax wages (pre-tax 401(k) excluded). NOT CONFIRMED
// from a Mississippi primary source: Pub 89-700 and the DOR's income
// checklist don't address elective deferrals. Flagged for review.

const { formChecker, onFile } = require("./formUtil");

const STATUSES = ["single", "headOfFamily", "marriedSpouseNotEmployed", "marriedBothEmployed"];

const TABLES = Object.freeze({
  2026: Object.freeze({
    zeroBracketCents: 10_000_00,
    rateBp: 400,
    standardDeductionCents: Object.freeze({
      single: 2_300_00,
      headOfFamily: 3_400_00,
      marriedSpouseNotEmployed: 4_600_00,
      marriedBothEmployed: 2_300_00,
    }),
    sources: Object.freeze([
      "MS DOR, Pub 89-700-25-1 Withholding Income Tax Tables and Employer Instructions (Rev. 07/25, revised 1/13/2026): https://www.dor.ms.gov/sites/default/files/tax-forms/business/89700251revised1.13.2026.pdf",
    ]),
  }),
});

function validateForm(form) {
  if (!onFile(form)) return;
  const c = formChecker("Mississippi 89-350");
  c.oneOf(form, "status", STATUSES);
  c.cents(form, "exemptionCents");
  c.cents(form, "additionalWithholdingCents");
}

function compute({ taxYear, wagesCents, payPeriodsPerYear, form }) {
  const t = TABLES[taxYear];
  validateForm(form);
  const has = onFile(form);
  const status = has ? form.status : "single";
  const exemption = has ? form.exemptionCents ?? 0 : 0;
  const annual = wagesCents * payPeriodsPerYear;
  const taxableAnnual = Math.max(0, annual - exemption - t.standardDeductionCents[status]);
  const annualTax = (Math.max(0, taxableAnnual - t.zeroBracketCents) * t.rateBp) / 10_000;
  const extra = has ? form.additionalWithholdingCents ?? 0 : 0;
  return {
    stateCents: Math.round(annualTax / payPeriodsPerYear / 100) * 100 + extra,
    formBasis: has ? "89-350" : "none-on-file-zero-exemption",
    lines: { taxableAnnualCents: taxableAnnual, annualTaxCents: annualTax },
  };
}

module.exports = {
  code: "MS",
  name: "Mississippi",
  wageBasis: "federal-income-tax-wages",
  years: Object.keys(TABLES).map(Number),
  TABLES,
  validateForm,
  compute,
};

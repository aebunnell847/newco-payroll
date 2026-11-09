// SPDX-License-Identifier: MIT
//
// Delaware income tax withholding: Division of Revenue, "Employer's Guide
// (Withholding Regulations and Employer's Duties)", Section 17 annualized
// formula:
//   annualize (daily 300, weekly 52, biweekly 26, semimonthly 24, monthly 12)
//   - standard deduction ($3,250 single or married filing separately,
//     $6,500 married filing jointly)
//   tax on the rate schedule (0% to $2,000; 2.2%; 3.9%; 4.8%; 5.2%; 5.55%;
//     6.6% over $60,000 - unchanged since January 1, 2014)
//   - $110 per personal exemption; divide by the pay periods
// The guide's example (single, 1 allowance, $25,000 a year -> $722;
// $13.88 weekly ... $60.17 monthly) is in the tests.
//
// Exemptions: Delaware lets employers rely on the federal W-4 allowance
// count, or a Delaware-specific number the employee marks. Post-2020
// federal W-4s have no allowances, so this reads the Delaware figures:
//   stateW4: { filingStatus: "single" | "marriedJoint" | "marriedSeparate",
//     exemptions, additionalWithholdingCents? }.
// With no Delaware figures but a pre-2020 federal W-4, its marital status
// (married -> joint) and allowances are used.
// Otherwise: "withhold tax as if the employee is a single person who has no
// withholding allowances" (Section 15(a)).
//
// Wages: federal income-tax wages (Delaware withholding follows the federal
// W-4 and federal wages), so pre-tax 401(k) is excluded.
//
// Not covered: the City of Wilmington earned income tax (local).

const { formChecker, onFile } = require("./formUtil");
const { fromBaseTable } = require("./brackets");

const DE_2014_ON = Object.freeze({
  standardDeductionCents: Object.freeze({ single: 3_250_00, marriedJoint: 6_500_00, marriedSeparate: 3_250_00 }),
  exemptionCreditCents: 110_00,
  dailyPeriods: 300,
  schedule: Object.freeze([
    [0, 0, 0],
    [2_000_00, 0, 220],
    [5_000_00, 66_00, 390],
    [10_000_00, 261_00, 480],
    [20_000_00, 741_00, 520],
    [25_000_00, 1_001_00, 555],
    [60_000_00, 2_943_50, 660],
  ]),
  sources: Object.freeze([
    "Delaware Division of Revenue, Employer's Guide (Withholding Regulations and Employer's Duties): https://revenue.delaware.gov/employers-guide-withholding-regulations-employers-duties/",
  ]),
});
const TABLES = Object.freeze({ 2025: DE_2014_ON, 2026: DE_2014_ON });

function validateForm(form) {
  if (!onFile(form)) return;
  const c = formChecker("Delaware withholding certificate");
  c.oneOf(form, "filingStatus", ["single", "marriedJoint", "marriedSeparate"]);
  c.nonNegInt(form, "exemptions");
  c.cents(form, "additionalWithholdingCents");
}

function compute({ taxYear, wagesCents, payPeriodsPerYear, form, federalW4 = null }) {
  const t = TABLES[taxYear];
  validateForm(form);
  let status = "single";
  let exemptions = 0;
  let formBasis = "none-on-file-single-zero";
  if (onFile(form)) {
    status = form.filingStatus;
    exemptions = form.exemptions ?? 0;
    formBasis = "delaware-certificate";
  } else if (federalW4 && federalW4.formYear < 2020) {
    status = federalW4.maritalStatus === "married" ? "marriedJoint" : "single";
    exemptions = federalW4.allowances ?? 0;
    formBasis = "federal-w4-pre-2020";
  }
  const P = payPeriodsPerYear === 260 ? t.dailyPeriods : payPeriodsPerYear;
  const taxable = Math.max(0, wagesCents * P - t.standardDeductionCents[status]);
  const annualTax = Math.max(0, fromBaseTable(taxable, t.schedule) - exemptions * t.exemptionCreditCents);
  const extra = onFile(form) ? form.additionalWithholdingCents ?? 0 : 0;
  return {
    stateCents: Math.round(annualTax / P) + extra,
    formBasis,
    lines: { P, taxableCents: taxable, annualTaxCents: annualTax },
  };
}

module.exports = {
  code: "DE",
  name: "Delaware",
  wageBasis: "federal-income-tax-wages",
  years: Object.keys(TABLES).map(Number),
  TABLES,
  validateForm,
  compute,
};

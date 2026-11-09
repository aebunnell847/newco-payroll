// SPDX-License-Identifier: MIT
//
// Wisconsin income tax withholding: Publication W-166 (1/26), "Alternate
// Method of Withholding Wisconsin Income Tax" (employers may use it
// "without receiving any further approval from the department"):
//   (a) annual gross = period wage x periods
//   (b) minus a deduction that phases out with earnings:
//       single  $6,702 under $17,780; $6,702 - 12% x (gross - $17,780);
//               $0 at $73,630+
//       married $9,461 under $25,727; $9,461 - 20% x (gross - $25,727);
//               $0 at $73,032+
//   (c) minus $400 per WT-4 exemption = annual net wage
//   (d) 3.54% to $12,760; $451.70 + 4.65% to $25,520;
//       $1,045.04 + 5.30% to $280,950; $14,582.83 + 7.65% over
//   (e) divide by the payroll periods
// Both W-166 examples ($350 weekly, 1 exemption -> $7.59; $500 weekly,
// 3 exemptions -> $14.34) are in the tests.
//
// WT-4 input: { filingStatus: "single" | "married" |
//   "marriedWithholdAtSingle", exemptions, additionalWithholdingCents?,
//   exempt? }.
// No WT-4 on file: "the employee shall be considered as claiming zero
// withholding exemptions" (W-166). W-166 doesn't name a status for that
// case; this uses single (the higher-withholding choice). Flagged.
//
// Wages: Wisconsin withholding "generally conform[s] to the federal
// Internal Revenue Code" (W-166), so pre-tax 401(k) is excluded.

const { formChecker, onFile } = require("./formUtil");
const { fromBaseTable } = require("./brackets");

const TABLES = Object.freeze({
  2026: Object.freeze({
    deduction: Object.freeze({
      single: Object.freeze({ fullCents: 6_702_00, phaseStartCents: 17_780_00, zeroAtCents: 73_630_00, phaseBp: 1_200 }),
      married: Object.freeze({ fullCents: 9_461_00, phaseStartCents: 25_727_00, zeroAtCents: 73_032_00, phaseBp: 2_000 }),
    }),
    exemptionCents: 400_00,
    annualTable: Object.freeze([
      [0, 0, 354],
      [12_760_00, 451_70, 465],
      [25_520_00, 1_045_04, 530],
      [280_950_00, 14_582_83, 765],
    ]),
    sources: Object.freeze([
      "Wisconsin DOR, Publication W-166 Withholding Tax Guide (1/26): https://www.revenue.wi.gov/DOR%20Publications/pb166.pdf",
    ]),
  }),
});

function deductionCents(d, gross) {
  if (gross < d.phaseStartCents) return d.fullCents;
  if (gross >= d.zeroAtCents) return 0;
  return Math.max(0, d.fullCents - ((gross - d.phaseStartCents) * d.phaseBp) / 10_000);
}

function validateForm(form) {
  if (!onFile(form)) return;
  const c = formChecker("Wisconsin WT-4");
  c.bool(form, "exempt");
  if (form.exempt) return;
  c.oneOf(form, "filingStatus", ["single", "married", "marriedWithholdAtSingle"]);
  c.nonNegInt(form, "exemptions");
  c.cents(form, "additionalWithholdingCents");
}

function compute({ taxYear, wagesCents, payPeriodsPerYear, form }) {
  const t = TABLES[taxYear];
  validateForm(form);
  const has = onFile(form);
  if (has && form.exempt) return { stateCents: 0, formBasis: "wt-4-exempt", lines: {} };
  const status = has && form.filingStatus === "married" ? "married" : "single";
  const gross = wagesCents * payPeriodsPerYear;
  const deduction = deductionCents(t.deduction[status], gross);
  const net = Math.max(0, gross - deduction - (has ? form.exemptions ?? 0 : 0) * t.exemptionCents);
  const annualTax = fromBaseTable(net, t.annualTable);
  const extra = has ? form.additionalWithholdingCents ?? 0 : 0;
  return {
    stateCents: Math.round(annualTax / payPeriodsPerYear) + extra,
    formBasis: has ? "wt-4" : "none-on-file-zero-exemptions",
    lines: { grossCents: gross, deductionCents: deduction, netCents: net, annualTaxCents: annualTax },
  };
}

module.exports = {
  code: "WI",
  name: "Wisconsin",
  wageBasis: "federal-income-tax-wages",
  years: Object.keys(TABLES).map(Number),
  TABLES,
  validateForm,
  compute,
};

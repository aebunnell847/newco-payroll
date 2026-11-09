// SPDX-License-Identifier: MIT
//
// Michigan income tax withholding: Form 446, 2026 Michigan Income Tax
// Withholding Guide - "a direct percentage computation": 4.25% of
// compensation after deducting the personal and dependency exemption
// allowance (exemptions x $5,900 for 2026, prorated to the pay period).
//
// MI-W4 input: { exemptions, additionalWithholdingCents?, exempt? }.
// The federal W-4 cannot stand in for it. No valid MI-W4 on file: withhold
// on total compensation with zero exemptions (Form 446, "Employee
// Exemptions").
//
// Wages: federal income-tax wages. "Michigan reporting and withholding on
// fringe benefits follows federal guidelines ... Examples of fringe benefits
// include 401(k) deferred compensation" (Form 446).
//
// Not covered: the 24 Michigan cities with their own income tax (Detroit,
// Grand Rapids, ...), which are separate city withholding.

const { formChecker, onFile } = require("./formUtil");

const TABLES = Object.freeze({
  2025: Object.freeze({
    rateBp: 425,
    exemptionCents: 5_800_00,
    sources: Object.freeze([
      "MI Treasury, 446 (Rev. 01-25) 2025 Michigan Income Tax Withholding Guide: https://www.michigan.gov/taxes/-/media/Project/Websites/taxes/Forms/SUW/TY2025/446_Withholding-Guide_2025.pdf",
    ]),
  }),
  2026: Object.freeze({
    rateBp: 425,
    exemptionCents: 5_900_00,
    sources: Object.freeze([
      "MI Treasury, 446 (Rev. 02-26) 2026 Michigan Income Tax Withholding Guide: https://www.michigan.gov/taxes/-/media/Project/Websites/taxes/Forms/SUW/TY2026/446_Withholding-Guide_2026.pdf",
    ]),
  }),
});

function validateForm(form) {
  if (!onFile(form)) return;
  const c = formChecker("Michigan MI-W4");
  c.nonNegInt(form, "exemptions");
  c.cents(form, "additionalWithholdingCents");
  c.bool(form, "exempt");
}

function compute({ taxYear, wagesCents, payPeriodsPerYear, form }) {
  const t = TABLES[taxYear];
  validateForm(form);
  const has = onFile(form);
  if (has && form.exempt) return { stateCents: 0, formBasis: "mi-w4-exempt", lines: {} };
  const exemptions = has ? form.exemptions ?? 0 : 0;
  const allowance = (exemptions * t.exemptionCents) / payPeriodsPerYear;
  const taxable = Math.max(0, wagesCents - allowance);
  const extra = has ? form.additionalWithholdingCents ?? 0 : 0;
  return {
    stateCents: Math.round((taxable * t.rateBp) / 10_000) + extra,
    formBasis: has ? "mi-w4" : "none-on-file-zero-exemptions",
    lines: { allowanceCents: allowance, taxableCents: taxable },
  };
}

module.exports = {
  code: "MI",
  name: "Michigan",
  wageBasis: "federal-income-tax-wages",
  years: Object.keys(TABLES).map(Number),
  TABLES,
  validateForm,
  compute,
};

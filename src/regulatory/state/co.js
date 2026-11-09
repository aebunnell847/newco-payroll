// SPDX-License-Identifier: MIT
//
// Colorado income tax withholding: DR 1098, 2026 Colorado Withholding
// Worksheet for Employers (Colorado no longer publishes tables):
//   2b = annual wages - line 2a allowance;  2c = 2b x 4.40%
//   2d = 2c / pay periods;                  2f = 2d + DR 0004 line 3 extra
//
// Which allowance (line 2a):
//   - DR 0004 on file: its line 2 amount, "including an amount of zero".
//     A blank line 2 falls back to the W-4 amount below.
//   - Only a federal W-4: $11,000 if its Step 1(c) is married filing jointly
//     or qualifying surviving spouse, $5,500 otherwise. A W-4 claiming
//     exempt means zero Colorado withholding.
//   - Neither: as if a W-4 with "single" ($5,500).
//   - A pre-2020 W-4 has no Step 1(c); DR 1098 doesn't say how to read one,
//     so this uses the "otherwise" amount ($5,500), the higher-withholding
//     choice. (Flagged; a DR 0004 avoids the question.)
//
// Wages: federal income-tax wages - "Wages that are exempt from federal
// wage withholding are generally exempt from Colorado wage withholding"
// (Colorado Wage Withholding Tax Guide), so pre-tax 401(k) is excluded.
//
// Not covered: Denver and Aurora occupational privilege taxes (local).

const { formChecker, onFile } = require("./formUtil");

const TABLES = Object.freeze({
  2026: Object.freeze({
    rateBp: 440,
    jointAllowanceCents: 11_000_00,
    otherAllowanceCents: 5_500_00,
    sources: Object.freeze([
      "CO DOR, DR 1098 2026 Colorado Withholding Worksheet for Employers (10/21/25): https://tax.colorado.gov/sites/tax/files/documents/DR_1098_Colorado_Withholding_Worksheet_for_Employees.pdf",
      "CO DOR, Colorado Wage Withholding Tax Guide: https://tax.colorado.gov/withholding-tax-guide",
    ]),
  }),
});

function validateForm(form) {
  if (!onFile(form)) return;
  const c = formChecker("Colorado DR 0004");
  if (form.line2AllowanceCents !== undefined && form.line2AllowanceCents !== null) c.cents(form, "line2AllowanceCents");
  c.cents(form, "additionalWithholdingCents");
}

function compute({ taxYear, wagesCents, payPeriodsPerYear, form, federalW4 = null }) {
  const t = TABLES[taxYear];
  validateForm(form);
  const dr0004 = onFile(form);
  let allowance;
  let formBasis;
  if (dr0004 && form.line2AllowanceCents !== undefined && form.line2AllowanceCents !== null) {
    allowance = form.line2AllowanceCents;
    formBasis = "dr-0004";
  } else if (federalW4) {
    if (!dr0004 && federalW4.exempt) return { stateCents: 0, formBasis: "federal-w4-exempt", lines: {} };
    const joint = federalW4.formYear >= 2020 && federalW4.filingStatus === "marriedFilingJointly";
    allowance = joint ? t.jointAllowanceCents : t.otherAllowanceCents;
    formBasis = dr0004 ? "dr-0004-line-2-blank-federal-w4" : "federal-w4";
  } else {
    allowance = t.otherAllowanceCents;
    formBasis = dr0004 ? "dr-0004-line-2-blank-single" : "none-on-file-single";
  }
  const annual = wagesCents * payPeriodsPerYear;
  const line2b = Math.max(0, annual - allowance);
  const line2c = (line2b * t.rateBp) / 10_000;
  const extra = dr0004 ? form.additionalWithholdingCents ?? 0 : 0;
  return {
    stateCents: Math.round(line2c / payPeriodsPerYear) + extra,
    formBasis,
    lines: { line1cCents: annual, line2aCents: allowance, line2bCents: line2b, line2cCents: line2c },
  };
}

module.exports = {
  code: "CO",
  name: "Colorado",
  wageBasis: "federal-income-tax-wages",
  years: Object.keys(TABLES).map(Number),
  TABLES,
  validateForm,
  compute,
};

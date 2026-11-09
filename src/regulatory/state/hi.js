// SPDX-License-Identifier: MIT
//
// Hawaii income tax withholding: Booklet A, Employer's Tax Guide (Rev. 2025,
// for withholding January 1, 2026 and after), Appendix Part 1 "Annualized
// Income Tax Withholding":
//   annual wage - $1,144 x HW-4 allowances - $4,350 extra lump-sum allowance
//   tax on the annual table (single incl. unmarried head of household, or
//   married), divided by the pay periods
// The booklet's example ($500 weekly, single, 3 allowances -> $497.99 a
// year, $9.58 a week) is in the tests. The per-period Part 2 tables use the
// same allowance values divided by the periods (e.g. $22.00 and $83.65
// weekly), which the tests also pin.
//
// HW-4 input: { filingStatus: "single" | "married" |
//   "marriedWithholdAtSingle", allowances, additionalWithholdingCents?,
//   exempt? }.
// No HW-4 on file: "withhold tax as if the employee was single and had
// claimed no withholding allowance" (Booklet A, Section 12).
//
// Wages: HRS 235-61(a) wages exclude "income excluded from gross income by
// section 235-7 or other provisions of this chapter"; Hawaii conforms to
// the federal exclusion of 401(k) elective deferrals, so pre-tax 401(k) is
// excluded. Booklet A doesn't mention 401(k) by name.

const { formChecker, onFile } = require("./formUtil");
const { fromBaseTable } = require("./brackets");

const TABLES = Object.freeze({
  2026: Object.freeze({
    allowanceCents: 1_144_00,
    extraAllowanceCents: 4_350_00,
    annualTables: Object.freeze({
      single: Object.freeze([
        [0, 0, 140],
        [9_600_00, 134_00, 320],
        [14_400_00, 288_00, 550],
        [19_200_00, 552_00, 640],
        [24_000_00, 859_00, 680],
        [36_000_00, 1_675_00, 720],
        [48_000_00, 2_539_00, 760],
        [125_000_00, 8_391_00, 790],
      ]),
      married: Object.freeze([
        [0, 0, 140],
        [19_200_00, 269_00, 320],
        [28_800_00, 576_00, 550],
        [38_400_00, 1_104_00, 640],
        [48_000_00, 1_718_00, 680],
        [72_000_00, 3_350_00, 720],
        [96_000_00, 5_078_00, 760],
        [250_000_00, 16_782_00, 790],
      ]),
    }),
    sources: Object.freeze([
      "Hawaii DOTAX, Booklet A Employer's Tax Guide (Rev. 2025, withholding Jan. 1, 2026 and after): https://files.hawaii.gov/tax/news/pubs/25BkltA.pdf",
      "Hawaii DOTAX, 2026 Employer Payroll Updates: https://tax.hawaii.gov/payrollupdate/",
      "Hawaii DOTAX, Form HW-4: https://files.hawaii.gov/tax/forms/current/hw4_i.pdf",
    ]),
  }),
});

function validateForm(form) {
  if (!onFile(form)) return;
  const c = formChecker("Hawaii HW-4");
  c.bool(form, "exempt");
  if (form.exempt) return;
  c.oneOf(form, "filingStatus", ["single", "married", "marriedWithholdAtSingle"]);
  c.nonNegInt(form, "allowances");
  c.cents(form, "additionalWithholdingCents");
}

function compute({ taxYear, wagesCents, payPeriodsPerYear, form }) {
  const t = TABLES[taxYear];
  validateForm(form);
  const has = onFile(form);
  if (has && form.exempt) return { stateCents: 0, formBasis: "hw-4-exempt", lines: {} };
  const status = has && form.filingStatus === "married" ? "married" : "single";
  const subject = Math.max(
    0,
    wagesCents * payPeriodsPerYear - (has ? form.allowances ?? 0 : 0) * t.allowanceCents - t.extraAllowanceCents
  );
  const annualTax = fromBaseTable(subject, t.annualTables[status]);
  const extra = has ? form.additionalWithholdingCents ?? 0 : 0;
  return {
    stateCents: Math.round(annualTax / payPeriodsPerYear) + extra,
    formBasis: has ? "hw-4" : "none-on-file-single-zero",
    lines: { subjectCents: subject, annualTaxCents: annualTax },
  };
}

module.exports = {
  code: "HI",
  name: "Hawaii",
  wageBasis: "federal-income-tax-wages",
  years: Object.keys(TABLES).map(Number),
  TABLES,
  validateForm,
  compute,
};

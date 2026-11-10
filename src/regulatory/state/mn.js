// SPDX-License-Identifier: MIT
//
// Minnesota income tax withholding: "Minnesota Income Tax Withholding
// Instruction Booklet and Tax Tables" (start using Jan. 1, 2026), Computer
// Formula (page 34; "supersedes any formulas before Jan. 1, 2026"):
//   annual wage = period wage x periods (daily 360, weekly 52, biweekly 26,
//     semimonthly 24, monthly 12, annual 1)
//   - $5,300 per W-4MN allowance
//   chart: single 5.35% over $4,700 ... 9.85%; married 5.35% over $14,700
//     ... 9.85%
//   divide by the periods ("You may round the amount to the nearest
//   dollar"; this keeps the cent)
// The booklet prints no formula example; the tests pin each chart row's
// "Add" amount to the bracket below it.
//
// W-4MN input: { filingStatus: "single" | "married" |
//   "marriedWithholdAtSingle", allowances, additionalWithholdingCents?,
//   exempt? }.
// No W-4MN on file: "withhold tax at the single filing status with zero
// allowances" (booklet).
//
// Wages: wages subject to federal withholding (booklet), so pre-tax 401(k)
// is excluded.

const { formChecker, onFile } = require("./formUtil");
const { fromBaseTable } = require("./brackets");

const TABLES = Object.freeze({
  2025: Object.freeze({
    allowanceCents: 5_200_00,
    dailyPeriods: 360,
    charts: Object.freeze({
      single: Object.freeze([
        [0, 0, 0],
        [4_550_00, 0, 535],
        [37_120_00, 1_742_50, 680],
        [111_540_00, 6_803_06, 785],
        [203_180_00, 13_996_80, 985],
      ]),
      married: Object.freeze([
        [0, 0, 0],
        [14_300_00, 0, 535],
        [61_920_00, 2_547_67, 680],
        [203_480_00, 12_173_75, 785],
        [344_710_00, 23_260_31, 985],
      ]),
    }),
    sources: Object.freeze([
      "Minnesota DOR, 2025 Minnesota Income Tax Withholding Instruction Booklet and Tax Tables, Computer Formula: https://www.revenue.state.mn.us/sites/default/files/2024-12/wh-inst-25_0.pdf",
    ]),
  }),
  2026: Object.freeze({
    allowanceCents: 5_300_00,
    dailyPeriods: 360,
    charts: Object.freeze({
      single: Object.freeze([
        [0, 0, 0],
        [4_700_00, 0, 535],
        [38_010_00, 1_782_09, 680],
        [114_130_00, 6_958_25, 785],
        [207_850_00, 14_315_27, 985],
      ]),
      married: Object.freeze([
        [0, 0, 0],
        [14_700_00, 0, 535],
        [63_400_00, 2_605_45, 680],
        [208_180_00, 12_450_49, 785],
        [352_630_00, 23_789_82, 985],
      ]),
    }),
    sources: Object.freeze([
      "Minnesota DOR, 2026 Withholding Instruction Booklet and Tax Tables (Computer Formula, p. 34): https://www.revenue.state.mn.us/sites/default/files/2025-12/wh-inst-26.pdf",
    ]),
  }),
});

function validateForm(form) {
  if (!onFile(form)) return;
  const c = formChecker("Minnesota W-4MN");
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
  if (has && form.exempt) return { stateCents: 0, formBasis: "w-4mn-exempt", lines: {} };
  const P = payPeriodsPerYear === 260 ? t.dailyPeriods : payPeriodsPerYear;
  const status = has && form.filingStatus === "married" ? "married" : "single";
  const step4 = wagesCents * P - (has ? form.allowances ?? 0 : 0) * t.allowanceCents;
  const annualTax = step4 > 0 ? fromBaseTable(step4, t.charts[status]) : 0;
  const extra = has ? form.additionalWithholdingCents ?? 0 : 0;
  return {
    stateCents: Math.round(annualTax / P) + extra,
    formBasis: has ? "w-4mn" : "none-on-file-single-zero",
    lines: { P, step4Cents: step4, annualTaxCents: annualTax },
  };
}

module.exports = {
  code: "MN",
  name: "Minnesota",
  wageBasis: "federal-income-tax-wages",
  years: Object.keys(TABLES).map(Number),
  TABLES,
  validateForm,
  compute,
};

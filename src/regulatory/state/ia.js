// SPDX-License-Identifier: MIT
//
// Iowa income tax withholding: "Iowa Individual Income Tax Withholding
// Formula, Effective January 1, 2026":
//   T1 = G - D              (gross taxable wages - deduction for the period)
//   T2 = T1 x 3.80%
//   T3 = T2 - W / P         (total allowance amount / pay periods per year)
//   T4 = T3 + A             (additional withholding requested)
// Each step is carried to the cent, as in the formula's ten worked
// examples (all ten are in the tests).
//
// D depends on the IA W-4's year:
//   2024-or-later IA W-4: column A (other, joint with an earning spouse, or
//     status missing), B (head of household), C (joint, spouse has no earned
//     income, or qualifying surviving spouse); W is the dollar allowance
//     amount the employee entered.
//   2023-or-earlier IA W-4: column A (single, or married but legally
//     separated, or missing), B (married); W = allowances x $40.
// Pay frequencies outside the printed table (quarterly, semiannual) use the
// annual figures and divide T3 by the periods, as the formula says.
// No IA W-4 on file: status missing -> column A, no allowances.
//
// IA W-4 input: { formYear, maritalStatus, allowanceCents? (2024+),
//   allowances? (2023-), additionalWithholdingCents?, exempt? }
//   2024+ maritalStatus: "other" | "marriedJointSpouseEarns" |
//     "headOfHousehold" | "marriedJointSpouseNoEarnings" | "survivingSpouse"
//   2023- maritalStatus: "single" | "married"
//
// Wages: "Certain payments made by the employer into employee retirement
// plans ... are not considered taxable wages" (the formula, Step 1), so
// pre-tax 401(k) is excluded.

const { formChecker, onFile, PERIOD_BY_COUNT } = require("./formUtil");

const TABLES = Object.freeze({
  2025: Object.freeze({
    rateBp: 380,
    legacyAllowanceCents: 40_00,
    deductionCents: Object.freeze({
      current: Object.freeze({
        A: Object.freeze({ daily: 46_15, weekly: 230_77, biweekly: 461_54, semimonthly: 500_00, monthly: 1_000_00, annual: 12_000_00 }),
        B: Object.freeze({ daily: 69_42, weekly: 347_12, biweekly: 694_23, semimonthly: 752_08, monthly: 1_504_17, annual: 18_050_00 }),
        C: Object.freeze({ daily: 92_50, weekly: 462_50, biweekly: 925_00, semimonthly: 1_002_08, monthly: 2_004_17, annual: 24_050_00 }),
      }),
      legacy: Object.freeze({
        A: Object.freeze({ daily: 46_15, weekly: 230_77, biweekly: 461_54, semimonthly: 500_00, monthly: 1_000_00, annual: 12_000_00 }),
        B: Object.freeze({ daily: 92_50, weekly: 462_50, biweekly: 925_00, semimonthly: 1_002_08, monthly: 2_004_17, annual: 24_050_00 }),
      }),
    }),
    sources: Object.freeze([
      "Iowa DOR, Iowa Individual Income Tax Withholding Formula Effective January 1, 2025 (released Nov. 2024): https://revenue.iowa.gov/media/61/download",
      "Iowa DOR, 2025 Withholding Tax Information: https://revenue.iowa.gov/taxes/tax-guidance/withholding-tax/iowa-withholding-tax-information/2025-withholding-tax-information",
    ]),
  }),
  2026: Object.freeze({
    rateBp: 380,
    legacyAllowanceCents: 40_00,
    // Per-period deduction (D), from "Deduction Amounts by Pay Period".
    deductionCents: Object.freeze({
      current: Object.freeze({
        A: Object.freeze({ daily: 50_00, weekly: 250_00, biweekly: 500_00, semimonthly: 541_67, monthly: 1_083_33, annual: 13_000_00 }),
        B: Object.freeze({ daily: 75_00, weekly: 375_00, biweekly: 750_00, semimonthly: 812_50, monthly: 1_625_00, annual: 19_500_00 }),
        C: Object.freeze({ daily: 100_00, weekly: 500_00, biweekly: 1_000_00, semimonthly: 1_083_33, monthly: 2_166_67, annual: 26_000_00 }),
      }),
      legacy: Object.freeze({
        A: Object.freeze({ daily: 50_00, weekly: 250_00, biweekly: 500_00, semimonthly: 541_67, monthly: 1_083_33, annual: 13_000_00 }),
        B: Object.freeze({ daily: 100_00, weekly: 500_00, biweekly: 1_000_00, semimonthly: 1_083_33, monthly: 2_166_67, annual: 26_000_00 }),
      }),
    }),
    sources: Object.freeze([
      "Iowa DOR, Iowa Individual Income Tax Withholding Formula Effective January 1, 2026 (released Nov. 2025): https://revenue.iowa.gov/media/53/download?inline=",
      "Iowa DOR, 2026 IA W-4: https://revenue.iowa.gov/media/4324/download?inline=",
    ]),
  }),
});

const CURRENT_STATUSES = {
  other: "A",
  marriedJointSpouseEarns: "A",
  headOfHousehold: "B",
  marriedJointSpouseNoEarnings: "C",
  survivingSpouse: "C",
};
const LEGACY_STATUSES = { single: "A", married: "B" };

function validateForm(form) {
  if (!onFile(form)) return;
  const c = formChecker("Iowa IA W-4");
  if (!Number.isInteger(form.formYear)) c.fail("formYear must be an integer year");
  c.bool(form, "exempt");
  if (form.exempt) return;
  if (form.formYear >= 2024) {
    c.oneOf(form, "maritalStatus", Object.keys(CURRENT_STATUSES), { optional: true });
    c.cents(form, "allowanceCents");
  } else {
    c.oneOf(form, "maritalStatus", Object.keys(LEGACY_STATUSES), { optional: true });
    c.nonNegInt(form, "allowances");
  }
  c.cents(form, "additionalWithholdingCents");
}

function compute({ taxYear, wagesCents, payPeriodsPerYear, form }) {
  const t = TABLES[taxYear];
  validateForm(form);
  const has = onFile(form);
  if (has && form.exempt) return { stateCents: 0, formBasis: "ia-w-4-exempt", lines: {} };
  const legacy = has && form.formYear < 2024;
  const column = !has
    ? "A"
    : legacy
      ? LEGACY_STATUSES[form.maritalStatus] ?? "A"
      : CURRENT_STATUSES[form.maritalStatus] ?? "A";
  const W = !has ? 0 : legacy ? (form.allowances ?? 0) * t.legacyAllowanceCents : form.allowanceCents ?? 0;
  const extra = has ? form.additionalWithholdingCents ?? 0 : 0;
  const columns = t.deductionCents[legacy ? "legacy" : "current"][column];

  const printed = PERIOD_BY_COUNT[payPeriodsPerYear];
  const T3For = (G, D, P) => {
    const T1 = Math.max(0, G - D);
    const T2 = Math.round((T1 * t.rateBp) / 10_000);
    return { T1, T2, T3: Math.max(0, Math.round(T2 - W / P)) };
  };
  let lines;
  if (printed && columns[printed] !== undefined) {
    lines = T3For(wagesCents, columns[printed], payPeriodsPerYear);
  } else {
    // "Pay period not provided": annualize, run steps 1-3, divide T3 by the periods.
    const annual = T3For(wagesCents * payPeriodsPerYear, columns.annual, 1);
    lines = { ...annual, T3: Math.round(annual.T3 / payPeriodsPerYear) };
  }
  return {
    stateCents: lines.T3 + extra,
    formBasis: !has ? "none-on-file-column-a" : legacy ? "ia-w-4-2023-or-earlier" : "ia-w-4",
    lines: { ...lines, column, W },
  };
}

module.exports = {
  code: "IA",
  name: "Iowa",
  wageBasis: "federal-income-tax-wages",
  years: Object.keys(TABLES).map(Number),
  TABLES,
  validateForm,
  compute,
};

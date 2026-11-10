// SPDX-License-Identifier: MIT
//
// Maine income tax withholding: "Withholding Tables for Individual Income
// Tax", Revised August 2026 ("to reflect the increased Maine standard
// deduction amounts and the new income tax surcharge"), Percentage Method:
//   1. annualize (52 / 26 / 24 / 12 / 260)
//   2. allowances x $5,300
//   3. standard deduction: $12,850 single / $28,550 married, phased out
//      between $102,250-$177,250 single / $204,550-$354,550 married
//      (deduction x (top - annual wage) / span, to the whole dollar, which
//      reproduces Example 3's $22,945; the booklet's "round to 4 decimals"
//      note would give $22,946 there, so the example is followed)
//   4-5. annualized income on the rate schedule, plus the 2% surcharge on
//      income over $1,000,000 single / $1,500,000 married
//   6. divide by the periods, round to the nearest dollar
// All three of the booklet's percentage-method examples are in the tests.
//
// Effective date: the revision gives none. It is applied here to every 2026
// pay date (the original January 2026 booklet, with smaller deductions,
// governed earlier pay dates and is not encoded). Flagged.
//
// W-4ME input: { filingStatus: "single" | "married" |
//   "marriedWithholdAtSingle", allowances, additionalWithholdingCents?,
//   exempt? }.
// No valid W-4ME: "withhold as if the employee or payee were single and
// claiming no allowances" (booklet).
//
// Wages: federal income-tax wages; Maine withholding follows federal
// withholding wages, so pre-tax 401(k) is excluded.

const { formChecker, onFile } = require("./formUtil");
const { fromBaseTable } = require("./brackets");

const TABLES = Object.freeze({
  2025: Object.freeze({
    allowanceCents: 5_150_00,
    standardDeduction: Object.freeze({
      single: Object.freeze({ fullCents: 12_150_00, phaseStartCents: 100_000_00, zeroAtCents: 175_000_00 }),
      married: Object.freeze({ fullCents: 27_150_00, phaseStartCents: 200_050_00, zeroAtCents: 350_050_00 }),
    }),
    schedules: Object.freeze({
      single: Object.freeze([
        [0, 0, 580],
        [26_800_00, 1_554_00, 675],
        [63_450_00, 4_028_00, 715],
      ]),
      married: Object.freeze([
        [0, 0, 580],
        [53_600_00, 3_109_00, 675],
        [126_900_00, 8_057_00, 715],
      ]),
    }),
    // No surcharge before 2026.
    sources: Object.freeze([
      "Maine Revenue Services, 2025 Withholding Tables for Individual Income Tax, as archived Mar. 5, 2025: https://web.archive.org/web/20250305233852/https://www.maine.gov/revenue/sites/maine.gov.revenue/files/inline-files/25_wh_tab_instr.pdf",
    ]),
  }),
  2026: Object.freeze({
    allowanceCents: 5_300_00,
    standardDeduction: Object.freeze({
      single: Object.freeze({ fullCents: 12_850_00, phaseStartCents: 102_250_00, zeroAtCents: 177_250_00 }),
      married: Object.freeze({ fullCents: 28_550_00, phaseStartCents: 204_550_00, zeroAtCents: 354_550_00 }),
    }),
    schedules: Object.freeze({
      single: Object.freeze([
        [0, 0, 580],
        [27_400_00, 1_589_00, 675],
        [64_850_00, 4_117_00, 715],
      ]),
      married: Object.freeze([
        [0, 0, 580],
        [54_850_00, 3_181_00, 675],
        [129_750_00, 8_237_00, 715],
      ]),
    }),
    surcharge: Object.freeze({ rateBp: 200, single: 1_000_000_00, married: 1_500_000_00 }),
    sources: Object.freeze([
      "Maine Revenue Services, Withholding Tables for Individual Income Tax (Revised August 2026): https://www.maine.gov/revenue/sites/maine.gov.revenue/files/inline-files/26_wh_tab_instr_August2026.pdf",
    ]),
  }),
});

function standardDeductionCents(d, annual) {
  if (annual <= d.phaseStartCents) return d.fullCents;
  if (annual >= d.zeroAtCents) return 0;
  // Example 3: $28,550 x $120,550 / $150,000 = $22,944.68 -> $22,945 (whole dollars).
  return Math.round((d.fullCents * (d.zeroAtCents - annual)) / (d.zeroAtCents - d.phaseStartCents) / 100) * 100;
}

function validateForm(form) {
  if (!onFile(form)) return;
  const c = formChecker("Maine W-4ME");
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
  if (has && form.exempt) return { stateCents: 0, formBasis: "w-4me-exempt", lines: {} };
  const status = has && form.filingStatus === "married" ? "married" : "single";
  const annual = wagesCents * payPeriodsPerYear;
  const sd = standardDeductionCents(t.standardDeduction[status], annual);
  const income = annual - (has ? form.allowances ?? 0 : 0) * t.allowanceCents - sd;
  let annualTax = 0;
  if (income > 0) {
    annualTax =
      fromBaseTable(income, t.schedules[status]) +
      (t.surcharge ? (Math.max(0, income - t.surcharge[status]) * t.surcharge.rateBp) / 10_000 : 0);
  }
  const extra = has ? form.additionalWithholdingCents ?? 0 : 0;
  return {
    stateCents: Math.round(annualTax / payPeriodsPerYear / 100) * 100 + extra,
    formBasis: has ? "w-4me" : "none-on-file-single-zero",
    lines: { annualCents: annual, standardDeductionCents: sd, incomeCents: income, annualTaxCents: annualTax },
  };
}

module.exports = {
  code: "ME",
  name: "Maine",
  wageBasis: "federal-income-tax-wages",
  years: Object.keys(TABLES).map(Number),
  TABLES,
  standardDeductionCents,
  validateForm,
  compute,
};

// SPDX-License-Identifier: MIT
//
// Georgia income tax withholding: the Percentage Method in the 2026
// Employer's Withholding Tax Guide (revised Sept. 2026):
//   (1) taxable wages - standard deduction (Table F, columns 1-3)
//   (2) - dependent allowance x allowances (Table F, column 4)
//   (3) x 4.99%
//
// HB 463 cut the rate from 5.19% to 4.99% and raised the standard
// deductions ($15,000 single / HoH / married filing separately, $30,000
// joint) and the dependent deduction ($5,000), retroactive to Jan. 1, 2026.
// Employers "must continue to withhold at the rate of 5.19% before the
// effective date of the change and can begin withholding at the new rate
// of 4.99%, starting May 11, 2026." So these figures apply to pay dates
// from 2026-05-11. Earlier 2026 pay dates use the original 2026 Guide
// (Dec. 2025): 5.19%, $24,000 joint / $12,000 single and separate, $4,000
// per dependent - the Department's own PDF, as archived on Jan. 16, 2026
// (dor.georgia.gov now serves only the revised Guide).
//
// Table F per-period amounts are the annual figures divided by the number
// of periods, with "Daily (misc.)" divided by 365 (e.g. $30,000 -> $82.19).
// The tests pin every printed Table F figure against this.
//
// G-4 input: { maritalStatus: "A" | "B" | "C" | "D", dependentAllowances,
//   adjustmentAllowances, additionalWithholdingCents?, exempt? }
//   A single, B married (separate, or joint with both working),
//   C married joint with one spouse working, D head of household.
//   Column (1) $30,000 is for C; B uses column (3) ("Married couples, both
//   having income, should use the standard deduction allowed in column
//   (3)"). Lines 4 and 5 add up to the total allowances, each worth the
//   column (4) amount.
// No G-4 on file: the Guide lets employers use the federal election "if
// sufficient information is available"; otherwise single with zero
// allowances. This code always uses single / zero (the higher-withholding
// choice); flagged for review.
//
// Wages: "Georgia follows the federal guidelines governing [401(k)] plans.
// Contributions must be deducted from gross wages prior to the calculation
// of taxable income" (Guide, citing O.C.G.A. 48-7-27).

const { formChecker, onFile, tableInForce, PERIOD_BY_COUNT } = require("./formUtil");

const DIVISOR = Object.freeze({
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
  quarterly: 4,
  semiannual: 2,
  annual: 1,
  daily: 365,
});

const TABLES = Object.freeze({
  2026: Object.freeze({
    effectiveFrom: "2026-05-11",
    earlier: Object.freeze([
      Object.freeze({
        effectiveFrom: "2026-01-01",
        rateBp: 519,
        annualStandardDeductionCents: Object.freeze({ joint: 24_000_00, single: 12_000_00, separate: 12_000_00 }),
        annualAllowanceCents: 4_000_00,
        sources: Object.freeze([
          "GA DOR, Employer's Tax Guide 2026 (original, Dec. 2025; 'Employers must withhold at the rate of 5.19%'): https://dor.georgia.gov/document/document/2026-employers-tax-guide/download",
          "  as archived Jan. 16, 2026: https://web.archive.org/web/20260116155245/https://dor.georgia.gov/document/document/2026-employers-tax-guide/download",
          "GA DOR, Employer's Tax Guide 2026 (updated June 2026): 'Employers must continue to withhold at the rate of 5.19% before the effective date of the change': https://dor.georgia.gov/document/document/2026-employers-tax-guide-updated-june-2026/download",
        ]),
      }),
    ]),
    rateBp: 499,
    annualStandardDeductionCents: Object.freeze({ joint: 30_000_00, single: 15_000_00, separate: 15_000_00 }),
    annualAllowanceCents: 5_000_00,
    sources: Object.freeze([
      "GA DOR, Employer's Withholding Tax Guide 2026 (revised Sept. 2026): https://dor.georgia.gov/document/document/2026-employers-tax-guide-updated-september-2026/download",
      "GA DOR, Form G-4 (Rev. 06/03/26): https://dor.georgia.gov/document/form/tsdemployeeswithholdingallowancecertificateg-4pdf/download",
    ]),
  }),
});

const perPeriod = (annualCents, period) => Math.round(annualCents / DIVISOR[period]);

function validateForm(form) {
  if (!onFile(form)) return;
  const c = formChecker("Georgia G-4");
  c.bool(form, "exempt");
  if (form.exempt) return;
  c.oneOf(form, "maritalStatus", ["A", "B", "C", "D"]);
  c.nonNegInt(form, "dependentAllowances");
  c.nonNegInt(form, "adjustmentAllowances");
  c.cents(form, "additionalWithholdingCents");
}

function compute({ taxYear, wagesCents, payPeriodsPerYear, form, payDate }) {
  const t = tableInForce(TABLES[taxYear], payDate, "Georgia");
  validateForm(form);
  const period = PERIOD_BY_COUNT[payPeriodsPerYear];
  if (!period) throw new Error(`Georgia Table F has no column for ${payPeriodsPerYear} pay periods a year`);
  const has = onFile(form);
  if (has && form.exempt) return { stateCents: 0, formBasis: "g-4-exempt", lines: {} };
  const status = has ? form.maritalStatus : "A";
  const column = status === "C" ? "joint" : status === "B" ? "separate" : "single";
  const allowances = has ? (form.dependentAllowances ?? 0) + (form.adjustmentAllowances ?? 0) : 0;
  const deduction = perPeriod(t.annualStandardDeductionCents[column], period);
  const allowanceCents = allowances * perPeriod(t.annualAllowanceCents, period);
  const taxable = Math.max(0, wagesCents - deduction - allowanceCents);
  const extra = has ? form.additionalWithholdingCents ?? 0 : 0;
  return {
    stateCents: Math.round((taxable * t.rateBp) / 10_000) + extra,
    formBasis: has ? "g-4" : "none-on-file-single-zero",
    lines: { period, standardDeductionCents: deduction, allowanceCents, taxableCents: taxable },
  };
}

module.exports = {
  code: "GA",
  name: "Georgia",
  wageBasis: "federal-income-tax-wages",
  years: Object.keys(TABLES).map(Number),
  TABLES,
  perPeriod,
  validateForm,
  compute,
};

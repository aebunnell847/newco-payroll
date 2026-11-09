// SPDX-License-Identifier: MIT
//
// Alabama income tax withholding: "Withholding Tax Tables and Instructions
// for Employers and Withholding Agents" (revised January 2026), "Formula For
// Computing Alabama Withholding Tax":
//   1. GI = period wages x periods
//   2. deduct A. standard deduction (phases down with GI, by A-4 status)
//             B. the employee's annual federal withholding (this period's
//                actual federal income tax x periods)
//             C. personal exemption ($1,500 S / MS, $3,000 M / H, none "0")
//             D. dependents x $1,000 / $500 / $300 (by GI)
//   5. 2% / 4% / 5% brackets ($500 / $3,000 single-type, $1,000 / $6,000 M)
//   6. divide by the pay periods
// Alabama is the one state here that deducts federal income tax withheld,
// so it needs `federalWithholdingCents` (payroll passes it in).
// The standard deduction uses the formula's phase-down rule; the tests
// check it against the printed Schedule of Standard Deduction Amounts.
// The booklet's example ("M-2", $850 weekly, federal $35.19 -> $29.59) is
// in the tests.
//
// A-4 input: { exemption: "0" | "S" | "MS" | "M" | "H", dependents,
//   additionalWithholdingCents? }.
// No A-4 on file: "the employer should withhold using zero exemptions"
// (booklet) - the "0" status: single standard deduction, no personal
// exemption, single brackets.
//
// Wages: the booklet lists 401(k) cash or deferred arrangements among the
// IRC sections Alabama follows for exclusion, so pre-tax 401(k) is excluded.
//
// Not covered: Alabama city and county occupational taxes (Birmingham,
// Bessemer, Gadsden, ...).

const { formChecker, onFile } = require("./formUtil");
const { progressive } = require("./brackets");

const SINGLE_RATES = Object.freeze([
  [0, 200],
  [500_00, 400],
  [3_000_00, 500],
]);
const MARRIED_RATES = Object.freeze([
  [0, 200],
  [1_000_00, 400],
  [6_000_00, 500],
]);

// Standard deduction phase-down: [full, floor, phaseStartCents, stepCents, perStepCents]
const STANDARD_DEDUCTION = Object.freeze({
  "0": [3_000_00, 2_500_00, 25_999_00, 500_00, 25_00],
  S: [3_000_00, 2_500_00, 25_999_00, 500_00, 25_00],
  MS: [4_250_00, 2_500_00, 12_999_00, 250_00, 88_00],
  M: [8_500_00, 5_000_00, 25_999_00, 500_00, 175_00],
  H: [5_200_00, 2_500_00, 25_999_00, 500_00, 135_00],
});

const TABLES = Object.freeze({
  2025: Object.freeze({
    standardDeduction: STANDARD_DEDUCTION,
    personalExemptionCents: Object.freeze({ "0": 0, S: 1_500_00, MS: 1_500_00, M: 3_000_00, H: 3_000_00 }),
    dependentCents: Object.freeze([
      [50_000_00, 1_000_00],
      [100_000_00, 500_00],
      [Infinity, 300_00],
    ]),
    sources: Object.freeze([
      "Alabama DOR, Withholding Tax Tables and Instructions for Employers and Withholding Agents (revised January 2025; same formula and example as 2026), as archived Mar. 2, 2025: https://web.archive.org/web/20250302132833/https://www.revenue.alabama.gov/wp-content/uploads/2025/01/whbooklet_0125.pdf",
    ]),
  }),
  2026: Object.freeze({
    standardDeduction: STANDARD_DEDUCTION,
    personalExemptionCents: Object.freeze({ "0": 0, S: 1_500_00, MS: 1_500_00, M: 3_000_00, H: 3_000_00 }),
    dependentCents: Object.freeze([
      [50_000_00, 1_000_00],
      [100_000_00, 500_00],
      [Infinity, 300_00],
    ]),
    sources: Object.freeze([
      "Alabama DOR, Withholding Tax Tables and Instructions for Employers and Withholding Agents (revised Jan. 2026): https://www.revenue.alabama.gov/wp-content/uploads/2026/01/whbooklet_0126.pdf",
    ]),
  }),
});

function standardDeductionCents(status, GI) {
  const [full, floor, start, step, perStep] = STANDARD_DEDUCTION[status];
  if (GI <= start) return full;
  return Math.max(floor, full - Math.ceil((GI - start) / step) * perStep);
}

function validateForm(form) {
  if (!onFile(form)) return;
  const c = formChecker("Alabama A-4");
  c.oneOf(form, "exemption", ["0", "S", "MS", "M", "H"]);
  c.nonNegInt(form, "dependents");
  c.cents(form, "additionalWithholdingCents");
}

function compute({ taxYear, wagesCents, payPeriodsPerYear, form, federalWithholdingCents }) {
  const t = TABLES[taxYear];
  validateForm(form);
  if (!Number.isSafeInteger(federalWithholdingCents) || federalWithholdingCents < 0) {
    throw new Error("Alabama withholding deducts federal income tax withheld; federalWithholdingCents is required");
  }
  const has = onFile(form);
  const status = has ? form.exemption : "0";
  const GI = wagesCents * payPeriodsPerYear;
  const dependentEach = t.dependentCents.find(([upTo]) => GI <= upTo)[1];
  const deductions =
    standardDeductionCents(status, GI) +
    federalWithholdingCents * payPeriodsPerYear +
    t.personalExemptionCents[status] +
    (has ? form.dependents ?? 0 : 0) * dependentEach;
  const taxable = Math.max(0, GI - deductions);
  const annualTax = progressive(taxable, status === "M" ? MARRIED_RATES : SINGLE_RATES);
  const extra = has ? form.additionalWithholdingCents ?? 0 : 0;
  return {
    stateCents: Math.round(annualTax / payPeriodsPerYear) + extra,
    formBasis: has ? "a-4" : "none-on-file-zero-exemptions",
    lines: { GI, deductionsCents: deductions, taxableCents: taxable, annualTaxCents: annualTax },
  };
}

module.exports = {
  code: "AL",
  name: "Alabama",
  wageBasis: "federal-income-tax-wages",
  years: Object.keys(TABLES).map(Number),
  TABLES,
  standardDeductionCents,
  validateForm,
  compute,
};

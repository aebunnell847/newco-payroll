// SPDX-License-Identifier: MIT
//
// Oregon income tax withholding: 150-206-436 "Oregon Withholding Tax
// Formulas" (Rev. 12-31-25, effective Jan. 1, 2026), computer formula:
//   BASE = annual wages - federal income tax withheld (capped) - standard
//          deduction ($2,910 single/HoH, $5,820 married or single with 3+
//          allowances)
//   annual wages under $50,000: WH = 263 + 4.75% ... / 479 + 6.75% ... /
//     941 + 8.75% ... (single), 263 / 695 / 1,620 + ... (married table)
//   $50,000 or more: WH = 678 + 8.75% x (BASE - 11,400) / 10,618 + 9.9% ...
//     (single), 1,357 + 8.75% x (BASE - 22,800) / 21,237 + 9.9% ...
//     (married); the federal-tax cap phases out from $125,000 single /
//     $250,000 married; allowances are zeroed over $100,000 single /
//     $200,000 married
//   all: minus $263 per allowance, not below zero; divide by the periods
//     (rounding to the dollar is optional; this keeps the cent)
// Oregon subtracts federal income tax withheld, so it needs
// `federalWithholdingCents` (payroll passes it in).
//
// Inconsistencies in the publication, resolved toward the formula itself
// (flagged): the text says the federal subtraction "can't be more than
// $8,500 per year in 2025" and FAQ 3 says $8,500, but every formula box says
// $8,750, which is used. Example 1's text says BASE $21,165 and $1,798; its
// own worked lines give BASE $21,090 and $1,789 (and list a $256 credit vs
// the formula's $263). The tests follow the worked lines.
//
// OR-W-4 input: { filingStatus: "single" | "married" |
//   "marriedWithholdAtSingle", allowances, additionalWithholdingCents?,
//   exempt? }. Married-at-single-rate uses the single phase-out (FAQ 4).
// No OR-W-4 (or other withholding statement) on file: "withhold income tax
// at a rate of eight (8) percent of employee wages" (HB 2119 (2019)).
//
// Wages: FAQ 6 - not included are "retirement plans (section 401k, etc.)".
//
// Statewide transit tax (ORS 320.550): 0.1% of wages, withheld from every
// employee working in Oregon (and Oregon residents working elsewhere, which
// this work-state engine doesn't see), on the same ORS 316.162 wages - so
// it's withheld whatever the OR-W-4 says, including with no certificate or
// an exemption from income tax withholding ("employees with high
// exemptions ... are subject to Statewide Transit Tax withholding").
// Returned as the OR_STT locality. Not covered: the TriMet and Lane
// Transit District taxes, which are employer-paid, not withheld.
//
// Measure 120 (repealing the transit tax) "did not pass in the May 19,
// 2026 primary election", so the rate continues (DOR).

const { formChecker, onFile } = require("./formUtil");
const { fromBaseTable } = require("./brackets");

const TABLES = Object.freeze({
  2025: Object.freeze({
    standardDeductionCents: Object.freeze({ single: 2_835_00, married: 5_670_00 }),
    federalCapCents: 8_500_00,
    exemptionCreditCents: 256_00,
    noCertificateRateBp: 800,
    transitTaxBp: 10,
    under50k: Object.freeze({
      single: Object.freeze([
        [0, 256_00, 475],
        [4_400_00, 465_00, 675],
        [11_100_00, 917_00, 875],
      ]),
      married: Object.freeze([
        [0, 256_00, 475],
        [8_800_00, 674_00, 675],
        [22_200_00, 1_579_00, 875],
      ]),
    }),
    over50k: Object.freeze({
      single: Object.freeze([
        [0, 661_00, 875, 11_100_00],
        [125_000_00, 10_627_00, 990, 125_000_00],
      ]),
      married: Object.freeze([
        [0, 1_323_00, 875, 22_200_00],
        [250_000_00, 21_256_00, 990, 250_000_00],
      ]),
    }),
    phaseOut: Object.freeze({
      single: Object.freeze([
        [0, 8_500_00],
        [125_000_00, 6_800_00],
        [130_000_00, 5_100_00],
        [135_000_00, 3_400_00],
        [140_000_00, 1_700_00],
        [145_000_00, 0],
      ]),
      married: Object.freeze([
        [0, 8_500_00],
        [250_000_00, 6_800_00],
        [260_000_00, 5_100_00],
        [270_000_00, 3_400_00],
        [280_000_00, 1_700_00],
        [290_000_00, 0],
      ]),
    }),
    sources: Object.freeze([
      "Oregon DOR, Withholding Tax Formulas, effective January 1, 2025 (150-206-436, Rev. 12-10-24): https://www.oregon.gov/dor/forms/FormsPubs/withholding-tax-formulas_206-436_2025.pdf",
      "Oregon DOR, Statewide Transit Tax: https://www.oregon.gov/dor/programs/businesses/Pages/statewide-transit-tax.aspx",
    ]),
  }),
  2026: Object.freeze({
    standardDeductionCents: Object.freeze({ single: 2_910_00, married: 5_820_00 }),
    federalCapCents: 8_750_00,
    exemptionCreditCents: 263_00,
    noCertificateRateBp: 800,
    transitTaxBp: 10,
    under50k: Object.freeze({
      single: Object.freeze([
        [0, 263_00, 475],
        [4_550_00, 479_00, 675],
        [11_400_00, 941_00, 875],
      ]),
      married: Object.freeze([
        [0, 263_00, 475],
        [9_100_00, 695_00, 675],
        [22_800_00, 1_620_00, 875],
      ]),
    }),
    // [overCents, baseCents, rateBp, measuredFromCents]: the >= $50,000 rows
    // measure the 8.75% excess from $11,400 / $22,800, not from the row start.
    over50k: Object.freeze({
      single: Object.freeze([
        [0, 678_00, 875, 11_400_00],
        [125_000_00, 10_618_00, 990, 125_000_00],
      ]),
      married: Object.freeze([
        [0, 1_357_00, 875, 22_800_00],
        [250_000_00, 21_237_00, 990, 250_000_00],
      ]),
    }),
    // Federal-tax cap phase-out by annual wages: [wagesAtLeastCents, capCents].
    phaseOut: Object.freeze({
      single: Object.freeze([
        [0, 8_750_00],
        [125_000_00, 7_000_00],
        [130_000_00, 5_250_00],
        [135_000_00, 3_500_00],
        [140_000_00, 1_750_00],
        [145_000_00, 0],
      ]),
      married: Object.freeze([
        [0, 8_750_00],
        [250_000_00, 7_000_00],
        [260_000_00, 5_250_00],
        [270_000_00, 3_500_00],
        [280_000_00, 1_750_00],
        [290_000_00, 0],
      ]),
    }),
    sources: Object.freeze([
      "Oregon DOR, 150-206-436 Oregon Withholding Tax Formulas (Rev. 12-31-25): https://www.oregon.gov/dor/forms/FormsPubs/withholding-tax-formulas_206-436_2026.pdf",
      "Oregon DOR, Statewide Transit Tax: https://www.oregon.gov/dor/programs/businesses/Pages/statewide-transit-tax.aspx",
    ]),
  }),
});

function validateForm(form) {
  if (!onFile(form)) return;
  const c = formChecker("Oregon OR-W-4");
  c.bool(form, "exempt");
  if (form.exempt) return;
  c.oneOf(form, "filingStatus", ["single", "married", "marriedWithholdAtSingle"]);
  c.nonNegInt(form, "allowances");
  c.cents(form, "additionalWithholdingCents");
}

function compute(args) {
  const t = TABLES[args.taxYear];
  const out = incomeTax(args);
  return { ...out, localities: { OR_STT: Math.round((args.wagesCents * t.transitTaxBp) / 10_000) } };
}

function incomeTax({ taxYear, wagesCents, payPeriodsPerYear, form, federalWithholdingCents }) {
  const t = TABLES[taxYear];
  validateForm(form);
  const has = onFile(form);
  if (!has) {
    return { stateCents: Math.round((wagesCents * t.noCertificateRateBp) / 10_000), formBasis: "none-on-file-8-percent", lines: {} };
  }
  if (form.exempt) return { stateCents: 0, formBasis: "or-w-4-exempt", lines: {} };
  if (!Number.isSafeInteger(federalWithholdingCents) || federalWithholdingCents < 0) {
    throw new Error("Oregon withholding subtracts federal income tax withheld; federalWithholdingCents is required");
  }
  const wages = wagesCents * payPeriodsPerYear;
  let allowances = form.allowances ?? 0;
  const marriedBox = form.filingStatus === "married";
  const table = marriedBox || allowances >= 3 ? "married" : "single"; // "single with 3 or more allowances, or married"
  const phase = marriedBox ? "married" : "single"; // FAQ 4 and 7
  let cap = t.federalCapCents;
  if (wages >= 50_000_00) {
    for (const [atLeast, c] of t.phaseOut[phase]) if (wages >= atLeast) cap = c;
    if ((!marriedBox && wages > 100_000_00) || (marriedBox && wages > 200_000_00)) allowances = 0;
  }
  const federal = Math.min(federalWithholdingCents * payPeriodsPerYear, cap);
  const base = Math.max(0, wages - federal - t.standardDeductionCents[table]);
  let wh;
  if (wages < 50_000_00) {
    wh = fromBaseTable(base, t.under50k[table]);
  } else {
    let row = t.over50k[table][0];
    for (const r of t.over50k[table]) if (base >= r[0]) row = r;
    wh = row[1] + ((base - row[3]) * row[2]) / 10_000;
  }
  const annual = Math.max(0, wh - allowances * t.exemptionCreditCents);
  return {
    stateCents: Math.round(annual / payPeriodsPerYear) + (form.additionalWithholdingCents ?? 0),
    formBasis: "or-w-4",
    lines: { wagesCents: wages, federalSubtractedCents: federal, baseCents: base, annualCents: annual, table, allowances },
  };
}

module.exports = {
  code: "OR",
  name: "Oregon",
  wageBasis: "federal-income-tax-wages",
  years: Object.keys(TABLES).map(Number),
  TABLES,
  validateForm,
  compute,
};

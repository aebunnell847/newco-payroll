// SPDX-License-Identifier: MIT
//
// North Dakota income tax withholding: "Income Tax Withholding Rates &
// Instructions, 2026 Calendar Year". North Dakota has no state certificate;
// it relies on the federal Form W-4.
//
// 2020-or-later W-4, or a new hire with no W-4 (treated as single):
//   Section 2 Percentage Method Worksheet - annualize, apply the Annual
//   Percentage Method Table for the W-4 Step 1(c) filing status, divide by
//   the pay periods, round to the nearest dollar.
// Pre-2020 W-4: Section 1 - subtract $5,050 a year per allowance (the
//   per-period allowance is the annual figure / periods), then the same
//   single or married annual brackets, rounded to the dollar.
// Federal W-4 "exempt": no North Dakota withholding is computed here
//   either - flagged, since the booklet doesn't address it directly.
//
// About the booklet's Section 2 example ($1,800 weekly, single -> "$734.00"
// a year, "$14.00" a week): $734 is what the 2025 single threshold gives;
// with the 2026 table printed beside it ($57,625), the amount is $701.51
// a year, $13 a week. The example wasn't updated; this follows the table.
//
// Wages: "taxable wages" as for federal withholding, so pre-tax 401(k) is
// excluded.

const { fromBaseTable } = require("./brackets");

const TABLES = Object.freeze({
  2026: Object.freeze({
    annualTables: Object.freeze({
      single: Object.freeze([
        [0, 0, 0],
        [57_625_00, 0, 195],
        [258_450_00, 3_916_09, 250],
      ]),
      marriedFilingJointly: Object.freeze([
        [0, 0, 0],
        [57_500_00, 0, 195],
        [168_525_00, 2_164_99, 250],
      ]),
      headOfHousehold: Object.freeze([
        [0, 0, 0],
        [78_475_00, 0, 195],
        [289_675_00, 4_118_40, 250],
      ]),
    }),
    pre2020AllowanceCents: 5_050_00,
    sources: Object.freeze([
      "ND Office of State Tax Commissioner, Income Tax Withholding Rates & Instructions, 2026: https://www.tax.nd.gov/sites/www/files/documents/forms/individual/2026-iit/2026-income-tax-withholding-rates-booklet.pdf",
    ]),
  }),
});

function validateForm(form) {
  if (form !== null && form !== undefined) {
    throw new Error("North Dakota uses the federal Form W-4; stateW4 must be null for ND");
  }
}

function compute({ taxYear, wagesCents, payPeriodsPerYear, form, federalW4 = null }) {
  const t = TABLES[taxYear];
  validateForm(form);
  if (federalW4 && federalW4.exempt) return { stateCents: 0, formBasis: "federal-w4-exempt", lines: {} };
  const annual = wagesCents * payPeriodsPerYear;
  let table;
  let taxable = annual;
  let formBasis;
  if (federalW4 && federalW4.formYear < 2020) {
    table = t.annualTables[federalW4.maritalStatus === "married" ? "marriedFilingJointly" : "single"];
    taxable = Math.max(0, annual - (federalW4.allowances ?? 0) * t.pre2020AllowanceCents);
    formBasis = "federal-w4-pre-2020";
  } else if (federalW4) {
    table = t.annualTables[federalW4.filingStatus];
    formBasis = "federal-w4";
  } else {
    table = t.annualTables.single;
    formBasis = "none-on-file-single";
  }
  const annualTax = fromBaseTable(taxable, table);
  return {
    stateCents: Math.round(annualTax / payPeriodsPerYear / 100) * 100,
    formBasis,
    lines: { taxableAnnualCents: taxable, annualTaxCents: annualTax },
  };
}

module.exports = {
  code: "ND",
  name: "North Dakota",
  wageBasis: "federal-income-tax-wages",
  years: Object.keys(TABLES).map(Number),
  TABLES,
  validateForm,
  compute,
};

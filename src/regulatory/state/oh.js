// SPDX-License-Identifier: MIT
//
// Ohio income tax withholding: "Employer Withholding Taxes - Percentage
// Method (Effective August 1, 2026)" - new tables "for payrolls that end on
// or after August 1, 2026" after the HB 96 rate cut:
//   gross wage - (exemption amount for the period x exemptions)
//   1.600% to $26,050 a year; then 2.990%; over $100,000, 3.400%
// The per-period tables are the annual figures divided by the periods
// ($650 per exemption: $12.50 weekly ... $2.50 daily, daily = 260), and the
// tests reproduce every printed edge, base and exemption amount.
//
// Effective date: Ohio keys on the payroll's END date; payroll here keys on
// the pay date, so pay dates from 2026-08-01 are in scope and earlier ones
// throw (the October 2025 tables aren't sourced here). A period ending in
// July and paid in August should be reviewed by hand.
//
// IT 4 input: { exemptions, additionalWithholdingCents?, exempt? }.
// No IT 4 on file: the Percentage Method sheet doesn't say; this uses zero
// exemptions (the higher-withholding choice). Flagged.
//
// Wages: federal income-tax wages, so pre-tax 401(k) is excluded.
//
// Not covered: Ohio school district income tax and municipal income taxes.

const { formChecker, onFile, requirePayDateFrom, PERIOD_BY_COUNT } = require("./formUtil");
const { fromBaseTable } = require("./brackets");

const DIVISOR = Object.freeze({ daily: 260, weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 });

const TABLES = Object.freeze({
  2026: Object.freeze({
    effectiveFrom: "2026-08-01",
    annualExemptionCents: 650_00,
    annualEdgesCents: Object.freeze([26_050_00, 100_000_00]),
    ratesBp: Object.freeze([160, 299, 340]),
    sources: Object.freeze([
      "Ohio Department of Taxation, Employer Withholding Taxes - Percentage Method (Effective August 1, 2026): https://dam.assets.ohio.gov/image/upload/tax.ohio.gov/employer_withholding/2026%20Withholding%20Tables/WHT_PercentageMethod_2026.pdf",
      "Ohio Department of Taxation, New Ohio Withholding Rates Effective August 1, 2026: https://content.govdelivery.com/accounts/OHTAX/bulletins/420a1ea",
    ]),
  }),
});

/** The printed per-period table: edges rounded to the cent, bases built from them. */
function periodTable(t, period) {
  const n = DIVISOR[period];
  const [e1, e2] = t.annualEdgesCents.map((e) => Math.round(e / n));
  const [r0, r1, r2] = t.ratesBp;
  const b1 = Math.round((e1 * r0) / 10_000);
  const b2 = b1 + Math.round(((e2 - e1) * r1) / 10_000);
  return {
    exemptionCents: Math.round(t.annualExemptionCents / n),
    rows: [
      [0, 0, r0],
      [e1, b1, r1],
      [e2, b2, r2],
    ],
  };
}

function validateForm(form) {
  if (!onFile(form)) return;
  const c = formChecker("Ohio IT 4");
  c.bool(form, "exempt");
  if (form.exempt) return;
  c.nonNegInt(form, "exemptions");
  c.cents(form, "additionalWithholdingCents");
}

function compute({ taxYear, wagesCents, payPeriodsPerYear, form, payDate }) {
  const t = TABLES[taxYear];
  requirePayDateFrom(payDate, t.effectiveFrom, "Ohio");
  validateForm(form);
  const period = PERIOD_BY_COUNT[payPeriodsPerYear];
  if (!DIVISOR[period]) throw new Error(`Ohio has no percentage table for ${payPeriodsPerYear} pay periods a year`);
  const has = onFile(form);
  if (has && form.exempt) return { stateCents: 0, formBasis: "it-4-exempt", lines: {} };
  const { exemptionCents, rows } = periodTable(t, period);
  const taxable = Math.max(0, wagesCents - (has ? form.exemptions ?? 0 : 0) * exemptionCents);
  const tax = fromBaseTable(taxable, rows);
  const extra = has ? form.additionalWithholdingCents ?? 0 : 0;
  return {
    stateCents: Math.round(tax) + extra,
    formBasis: has ? "it-4" : "none-on-file-zero-exemptions",
    lines: { period, taxableCents: taxable },
  };
}

module.exports = {
  code: "OH",
  name: "Ohio",
  wageBasis: "federal-income-tax-wages",
  years: Object.keys(TABLES).map(Number),
  TABLES,
  periodTable,
  validateForm,
  compute,
};

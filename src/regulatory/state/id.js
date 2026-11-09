// SPDX-License-Identifier: MIT
//
// Idaho income tax withholding: "Table for Percentage Computation Method of
// Withholding" (EPB00744, revised 07-23-2026): 5.3% of wages over a
// threshold that depends on the payroll period and withholding status,
// rounded to the nearest whole dollar ("Computing Withholding").
//
// These tables were revised in July 2026 because the Idaho Child Tax Credit
// sunsetted (Idaho Code 63-3029L): the per-allowance amount is now zero, so
// ID W-4 allowances no longer change withholding. The Tax Commission says
// to use the revised tables going forward without adjusting back to Jan. 1,
// so they apply here to pay dates from 2026-07-23.
//
// Earlier 2026 pay dates use the table it replaced (EPB00744, 04-28-2025:
// $15,000 single / $30,000 married) with the Idaho Child Tax Credit
// Allowance Table (ICTCAT) from the "Computing Withholding" page as it read
// on Mar. 17, 2026 (archived): each ID W-4 allowance takes the printed
// per-period amount off wages first. The ICTCAT prints $161.16 semimonthly
// where $3,868 / 24 is $161.17; the printed figures are used as printed,
// and quarterly/semiannual (not printed) throw for an employee with
// allowances.
//
// Thresholds: the annual figures ($16,100 single, $32,200 married) divided
// by the periods and rounded to the dollar, which reproduces every printed
// per-period threshold (pinned in the tests).
//
// ID W-4 input: { withholdingStatus: "A" | "B" | "C", allowances?,
//   additionalWithholdingCents?, exempt? }  (A single / HoH, B married,
//   C married but withhold at the single rate).
// No ID W-4 on file: neither EPB00744 nor the Commission's "Computing
// Withholding" page says; this uses the single chart (the
// higher-withholding choice). Flagged for review.
//
// Wages: federal income-tax wages. Idaho's withholding statute (Idaho Code
// 63-3035) applies to wages subject to federal withholding (it borrows IRC
// 3401's exclusions), and Idaho taxable income starts from federal taxable
// income, which already excludes pre-tax 401(k) deferrals. Neither the
// table nor the "Computing Withholding" page addresses 401(k) directly.

const { formChecker, onFile, tableInForce } = require("./formUtil");

const TABLES = Object.freeze({
  2026: Object.freeze({
    effectiveFrom: "2026-07-23",
    earlier: Object.freeze([
      Object.freeze({
        effectiveFrom: "2026-01-01",
        rateBp: 530,
        annualThresholdCents: Object.freeze({ single: 15_000_00, married: 30_000_00 }),
        // ICTCAT: one allowance, by pay periods per year.
        allowanceCentsByPeriods: Object.freeze({ 1: 3_868_00, 12: 322_33, 24: 161_16, 26: 148_77, 52: 74_38, 260: 14_88 }),
        sources: Object.freeze([
          "Idaho State Tax Commission, Table for Percentage Computation Method of Withholding (EPB00744, 04-28-2025): https://tax.idaho.gov/wp-content/uploads/pubs/EPB00744/EPB00744_04-28-2025.pdf",
          "Idaho State Tax Commission, Computing Withholding (Idaho Child Tax Credit Allowance Table), as archived Mar. 17, 2026: https://web.archive.org/web/20260317083027/https://tax.idaho.gov/taxes/income-tax/withholding/computing/",
        ]),
      }),
    ]),
    rateBp: 530,
    annualThresholdCents: Object.freeze({ single: 16_100_00, married: 32_200_00 }),
    allowanceCents: 0,
    sources: Object.freeze([
      "Idaho State Tax Commission, Table for Percentage Computation Method of Withholding (EPB00744, 07-23-2026): https://tax.idaho.gov/wp-content/uploads/pubs/EPB00744/EPB00744_07-23-2026.pdf",
      "Idaho State Tax Commission, Withholding tables updated for 2026 (July 31, 2026): https://tax.idaho.gov/pressrelease/withholding-tables-updated-for-2026/",
      "Idaho State Tax Commission, Computing Withholding: https://tax.idaho.gov/taxes/income-tax/withholding/computing/",
      "Idaho State Tax Commission, Form ID W-4 (EFO00307): https://tax.idaho.gov/document-mngr/forms_efo00307/",
    ]),
  }),
});

const thresholdCents = (annualCents, payPeriodsPerYear) => Math.round(annualCents / payPeriodsPerYear / 100) * 100;

/** One ID W-4 allowance for the pay period (zero from July 23, 2026). */
function allowanceCents(t, payPeriodsPerYear, allowances) {
  if (!t.allowanceCentsByPeriods || allowances === 0) return t.allowanceCents ?? 0;
  const v = t.allowanceCentsByPeriods[payPeriodsPerYear];
  if (v === undefined) {
    throw new Error(`Idaho's Child Tax Credit Allowance Table has no amount for ${payPeriodsPerYear} pay periods a year`);
  }
  return v;
}

function validateForm(form) {
  if (!onFile(form)) return;
  const c = formChecker("Idaho ID W-4");
  c.bool(form, "exempt");
  if (form.exempt) return;
  c.oneOf(form, "withholdingStatus", ["A", "B", "C"]);
  c.nonNegInt(form, "allowances");
  c.cents(form, "additionalWithholdingCents");
}

function compute({ taxYear, wagesCents, payPeriodsPerYear, form, payDate }) {
  const t = tableInForce(TABLES[taxYear], payDate, "Idaho");
  validateForm(form);
  const has = onFile(form);
  if (has && form.exempt) return { stateCents: 0, formBasis: "id-w-4-exempt", lines: {} };
  const married = has && form.withholdingStatus === "B";
  const threshold = thresholdCents(t.annualThresholdCents[married ? "married" : "single"], payPeriodsPerYear);
  const allowances = has ? form.allowances ?? 0 : 0;
  const afterAllowances = wagesCents - allowances * allowanceCents(t, payPeriodsPerYear, allowances);
  const tax = (Math.max(0, afterAllowances - threshold) * t.rateBp) / 10_000;
  const extra = has ? form.additionalWithholdingCents ?? 0 : 0;
  return {
    stateCents: Math.round(tax / 100) * 100 + extra,
    formBasis: has ? "id-w-4" : "none-on-file-single",
    lines: { thresholdCents: threshold },
  };
}

module.exports = {
  code: "ID",
  name: "Idaho",
  wageBasis: "federal-income-tax-wages",
  years: Object.keys(TABLES).map(Number),
  TABLES,
  thresholdCents,
  validateForm,
  compute,
};

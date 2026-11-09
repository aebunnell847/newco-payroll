// SPDX-License-Identifier: MIT
//
// Massachusetts income tax withholding: Circular M, "Income Tax Withholding
// Tables at 5.0%, Effective January 1, 2026" (Rev. 12/25), Percentage
// Methods for Wages (page 12):
//   1. subtract the employee's U.S. Social Security (FICA) and Medicare
//      (and Massachusetts/U.S./Railroad retirement system) deductions - at
//      most $2,000 a year in total
//   2. subtract the exemption factors for the period ($85 weekly for one
//      exemption; more than one: $19 x number + $66; ... annually $1,000 x
//      number + $3,400)
//   3-4. annualize; 5% up to $1,107,750 (the 2026 surtax threshold), 9% above
//   5. divide by the periods
//   6-7. subtract the head-of-household tax value and, per blind person,
//      the blindness tax value for the period
//   "Do not withhold from employees who claim one or more exemptions if
//   their wages are less than" $154 weekly ... $8,000 annually.
// The tests cross-check rows of the printed 2026 weekly wage-bracket table.
// The Circular is a user-supplied copy of the DOR PDF (mass.gov blocks
// automated downloads); its source URL is below.
//
// FICA (step 1): payroll passes this period's employee FICA and the year's
// prior FICA wages. Prior FICA deducted is taken as 7.65% of prior FICA
// wages, which is exact until the $2,000 cap is reached (about $26,000 of
// wages, far below the Social Security wage base and the $200,000
// Additional Medicare threshold). Supplemental wages (bonuses paid
// separately, Circular M section G) aren't modeled.
//
// M-4 input: { exemptions (a claimed spouse counts as 4), headOfHousehold?,
//   blindCount? (0-2), additionalWithholdingCents?, exempt? }.
// No M-4 on file: the Circular's wage pages don't say; its pension rule
// ("If a recipient does not file Form M-4P ... withholding will be based
// on '0' exemptions") is applied by analogy. Flagged.
//
// Wages: pre-tax 401(k) elective deferrals are excluded "to the same extent"
// as federally, Roth 401(k) contributions are not (DOR, "Tax Treatment of
// Non-government Pensions"), so the base is federal income-tax wages.
// Massachusetts conforms to the Internal Revenue Code as of January 1,
// 2022; whether its deferral exclusion limit matches the current federal
// limit is not confirmed here (flagged).

const { formChecker, onFile, PERIOD_BY_COUNT } = require("./formUtil");

// Per payroll period: exemption factor [perExemption, plus], head-of-
// household and blindness tax values, and the no-withholding floor.
const PERIOD_VALUES = Object.freeze({
  weekly: Object.freeze({ factor: [19_00, 66_00], hoh: 2_31, blind: 2_12, floor: 154_00 }),
  biweekly: Object.freeze({ factor: [38_00, 131_00], hoh: 4_62, blind: 4_23, floor: 308_00 }),
  semimonthly: Object.freeze({ factor: [42_00, 141_00], hoh: 5_00, blind: 4_58, floor: 333_00 }),
  monthly: Object.freeze({ factor: [83_00, 284_00], hoh: 10_00, blind: 9_17, floor: 667_00 }),
  daily: Object.freeze({ factor: [3_00, 9_00], hoh: 33, blind: 30, floor: 22_00 }),
  annual: Object.freeze({ factor: [1_000_00, 3_400_00], hoh: 120_00, blind: 110_00, floor: 8_000_00 }),
});

const TABLES = Object.freeze({
  2026: Object.freeze({
    rateBp: 500,
    surtaxRateBp: 900,
    surtaxThresholdCents: 1_107_750_00,
    ficaSubtractionCapCents: 2_000_00,
    ficaRateBp: 765,
    periodValues: PERIOD_VALUES,
    sources: Object.freeze([
      "Massachusetts DOR, Circular M Income Tax Withholding Tables at 5.0%, Effective January 1, 2026 (Rev. 12/25): https://www.mass.gov/doc/massachusetts-circular-m-income-tax-withholding-tables-at-50-effective-january-1-2026/download",
      "Massachusetts DOR, Tax Treatment of Non-government Pensions (401(k) elective deferrals): https://www.mass.gov/info-details/tax-treatment-of-non-government-pensions",
    ]),
  }),
});

function exemptionFactorCents(pv, exemptions) {
  return exemptions > 0 ? exemptions * pv.factor[0] + pv.factor[1] : 0;
}

function validateForm(form) {
  if (!onFile(form)) return;
  const c = formChecker("Massachusetts M-4");
  c.bool(form, "exempt");
  if (form.exempt) return;
  c.nonNegInt(form, "exemptions");
  c.bool(form, "headOfHousehold");
  const blind = form.blindCount ?? 0;
  if (![0, 1, 2].includes(blind)) c.fail("blindCount must be 0, 1 or 2");
  c.cents(form, "additionalWithholdingCents");
}

function compute({ taxYear, wagesCents, payPeriodsPerYear, form, ficaCents, yearToDateFicaWagesCents = 0 }) {
  const t = TABLES[taxYear];
  validateForm(form);
  const period = PERIOD_BY_COUNT[payPeriodsPerYear] ?? (payPeriodsPerYear === 27 ? "biweekly" : null);
  const pv = period && t.periodValues[period];
  if (!pv) throw new Error(`Massachusetts has no percentage method for ${payPeriodsPerYear} pay periods a year`);
  if (!Number.isSafeInteger(ficaCents) || ficaCents < 0) {
    throw new Error("Massachusetts withholding subtracts employee FICA; ficaCents is required");
  }
  const has = onFile(form);
  if (has && form.exempt) return { stateCents: 0, formBasis: "m-4-exempt", lines: {} };
  const exemptions = has ? form.exemptions ?? 0 : 0;
  if (exemptions >= 1 && wagesCents < pv.floor) {
    return { stateCents: 0, formBasis: "m-4", lines: { period, belowFloor: true } };
  }

  const priorFica = Math.min(t.ficaSubtractionCapCents, Math.round((yearToDateFicaWagesCents * t.ficaRateBp) / 10_000));
  const ficaSubtracted = Math.min(ficaCents, t.ficaSubtractionCapCents - priorFica);
  const perPeriod = Math.max(0, wagesCents - ficaSubtracted - exemptionFactorCents(pv, exemptions));
  const annual = perPeriod * payPeriodsPerYear;
  const annualTax =
    (Math.min(annual, t.surtaxThresholdCents) * t.rateBp) / 10_000 +
    (Math.max(0, annual - t.surtaxThresholdCents) * t.surtaxRateBp) / 10_000;
  let tax = annualTax / payPeriodsPerYear;
  if (has && form.headOfHousehold) tax -= pv.hoh;
  if (has) tax -= (form.blindCount ?? 0) * pv.blind;
  const extra = has ? form.additionalWithholdingCents ?? 0 : 0;
  return {
    stateCents: Math.max(0, Math.round(tax)) + extra,
    formBasis: has ? "m-4" : "none-on-file-zero-exemptions",
    lines: { period, ficaSubtractedCents: ficaSubtracted, perPeriodTaxableCents: perPeriod, annualTaxCents: annualTax },
  };
}

module.exports = {
  code: "MA",
  name: "Massachusetts",
  wageBasis: "federal-income-tax-wages",
  years: Object.keys(TABLES).map(Number),
  TABLES,
  exemptionFactorCents,
  validateForm,
  compute,
};

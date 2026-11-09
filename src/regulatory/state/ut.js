// SPDX-License-Identifier: MIT
//
// Utah income tax withholding: Publication 14, Withholding Tax Guide
// (Rev. 4/26), "Utah Withholding Schedules", effective for pay periods
// beginning on or after June 1, 2026:
//   2. wages x 4.45%
//   3. base allowance (per schedule and status)
//   4. wages - threshold (not less than 0)
//   5. line 4 x 1.3%
//   6. line 3 - line 5 (not less than 0)
//   7. line 2 - line 6 (not less than 0) = withholding
// Lines are whole dollars, as in the Pub's six worked examples (all six are
// in the tests). The schedule figures are printed per pay period; they're
// encoded below from Schedules 1-8.
//
// Effective date: the Pub keys on the pay PERIOD start; payroll here keys
// on the pay date, so a pay date on or after 2026-06-01 uses these
// schedules. Earlier 2026 pay dates use the schedules they replaced: Pub 14
// Rev. 4/25 (effective June 1, 2025; 4.5%), as archived Jan. 14, 2026, all
// six of its worked examples in the tests too. A period that starts in May
// and pays in June should be reviewed by hand.
//
// Utah has no state withholding certificate: "Withhold amounts based on
// your employee's federal W-4 form" - single or married per the federal
// W-4's filing status. Married filing jointly uses the married schedule;
// single and head of household use the single schedule (the schedules
// have only those two columns). A pre-2020 W-4 marked married uses the
// married schedule. No federal W-4: single.
// stateW4 is only for Utah's two exclusions written on the W-4 ("Utah Only
// - Exempt, Interstate Transportation" / "... Military Spouse"):
//   { exempt: "interstateTransportation" | "militarySpouse" }.
//
// Wages: "Utah calculates withholding tax based on wages subject to
// federal withholding tax" (IRC 3401(a)), so pre-tax 401(k) is excluded.

const { formChecker, onFile, tableInForce, PERIOD_BY_COUNT } = require("./formUtil");

// [baseAllowanceDollars, thresholdDollars] per schedule, from Pub 14.
const SCHEDULES = Object.freeze({
  weekly: Object.freeze({ single: [9, 180], married: [19, 360] }),
  biweekly: Object.freeze({ single: [19, 360], married: [37, 719] }),
  semimonthly: Object.freeze({ single: [20, 390], married: [40, 779] }),
  monthly: Object.freeze({ single: [40, 779], married: [81, 1_558] }),
  quarterly: Object.freeze({ single: [121, 2_337], married: [243, 4_674] }),
  semiannual: Object.freeze({ single: [243, 4_674], married: [485, 9_348] }),
  annual: Object.freeze({ single: [485, 9_348], married: [970, 18_696] }),
  daily: Object.freeze({ single: [2, 36], married: [4, 72] }),
});

// Pub 14 Rev. 4/25 (in force Jan. 1 - May 31, 2026).
const SCHEDULES_REV_4_25 = Object.freeze({
  weekly: Object.freeze({ single: [9, 175], married: [17, 350] }),
  biweekly: Object.freeze({ single: [17, 350], married: [35, 701] }),
  semimonthly: Object.freeze({ single: [19, 379], married: [38, 759] }),
  monthly: Object.freeze({ single: [38, 759], married: [75, 1_518] }),
  quarterly: Object.freeze({ single: [113, 2_277], married: [225, 4_553] }),
  semiannual: Object.freeze({ single: [225, 4_554], married: [450, 9_107] }),
  annual: Object.freeze({ single: [450, 9_107], married: [900, 18_213] }),
  daily: Object.freeze({ single: [2, 35], married: [3, 70] }),
});

const TABLES = Object.freeze({
  2026: Object.freeze({
    effectiveFrom: "2026-06-01",
    earlier: Object.freeze([
      Object.freeze({
        effectiveFrom: "2026-01-01",
        rateBp: 450,
        phaseOutBp: 130,
        schedules: SCHEDULES_REV_4_25,
        sources: Object.freeze([
          "Utah State Tax Commission, Publication 14 Withholding Tax Guide (Rev. 4/25, effective June 1, 2025), as archived Jan. 14, 2026: https://web.archive.org/web/20260114210054/https://files.tax.utah.gov/tax/forms/pubs/pub-14.pdf",
        ]),
      }),
    ]),
    rateBp: 445,
    phaseOutBp: 130,
    schedules: SCHEDULES,
    sources: Object.freeze([
      "Utah State Tax Commission, Publication 14 Withholding Tax Guide (Rev. 4/26, effective June 1, 2026): https://files.tax.utah.gov/tax/forms/pubs/pub-14.pdf",
    ]),
  }),
});

function validateForm(form) {
  if (!onFile(form)) return;
  const c = formChecker("Utah (federal W-4 note)");
  c.oneOf(form, "exempt", ["interstateTransportation", "militarySpouse"]);
}

const dollars = (cents) => Math.round(cents / 100);

function compute({ taxYear, wagesCents, payPeriodsPerYear, form, federalW4 = null, payDate }) {
  const t = tableInForce(TABLES[taxYear], payDate, "Utah");
  validateForm(form);
  if (onFile(form)) return { stateCents: 0, formBasis: `utah-exempt-${form.exempt}`, lines: {} };
  const period = PERIOD_BY_COUNT[payPeriodsPerYear];
  if (!period) throw new Error(`Utah has no withholding schedule for ${payPeriodsPerYear} pay periods a year`);
  const married = Boolean(
    federalW4 &&
      (federalW4.formYear >= 2020 ? federalW4.filingStatus === "marriedFilingJointly" : federalW4.maritalStatus === "married")
  );
  const [base, threshold] = t.schedules[period][married ? "married" : "single"];
  const line2 = dollars((wagesCents * t.rateBp) / 10_000);
  const line4 = Math.max(0, wagesCents - threshold * 100);
  const line5 = dollars((line4 * t.phaseOutBp) / 10_000);
  const line6 = Math.max(0, base - line5);
  const line7 = Math.max(0, line2 - line6);
  return {
    stateCents: line7 * 100,
    formBasis: federalW4 ? "federal-w4" : "none-on-file-single",
    lines: { schedule: period, status: married ? "married" : "single", line2, line3: base, line4Cents: line4, line5, line6, line7 },
  };
}

module.exports = {
  code: "UT",
  name: "Utah",
  wageBasis: "federal-income-tax-wages",
  years: Object.keys(TABLES).map(Number),
  TABLES,
  validateForm,
  compute,
};

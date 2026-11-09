// SPDX-License-Identifier: MIT
//
// Arizona income tax withholding: the employee elects a percentage of gross
// taxable wages on Form A-4 (0.5%, 1.0%, ..., 3.5%, or zero if they expect
// no Arizona liability), plus any extra amount per paycheck.
// No A-4 on file: the default rate, 2.0% (A-4 employer instructions).
//
// A-4 input: { ratePercent: 0 | 0.5 | 1 | 1.5 | 2 | 2.5 | 3 | 3.5,
//   additionalWithholdingCents? }. ratePercent 0 is the zero election, which
// the employee must renew each year by Feb. 15; payroll stores whichever
// certificate is current.
//
// Wages: "'Gross taxable wages' is the amount that meets the federal
// definition of 'wages.' Generally, it is the amount included in box 1 of
// the employee's federal Form W-2" - so pre-tax 401(k) is excluded.

const { formChecker, onFile } = require("./formUtil");

const ALLOWED_RATES = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];

const TABLES = Object.freeze({
  2025: Object.freeze({
    defaultRatePercent: 2,
    sources: Object.freeze([
      "AZ DOR, Employer's Instructions for the Arizona Form A-4 (2025): https://azdor.gov/sites/default/files/document/FORMS_WITHHOLDING_2025_A-4i.pdf",
    ]),
  }),
  2026: Object.freeze({
    defaultRatePercent: 2,
    sources: Object.freeze([
      "AZ DOR, Employer's Instructions for the Arizona Form A-4 (2026): https://azdor.gov/sites/default/files/document/FORMS_WITHHOLDING_2026_A-4i.pdf",
      "AZ DOR, Arizona Form A-4 (2026): https://azdor.gov/sites/default/files/document/FORMS_WITHHOLDING_2026_A-4_f.pdf",
    ]),
  }),
});

function validateForm(form) {
  if (!onFile(form)) return;
  const c = formChecker("Arizona A-4");
  c.oneOf(form, "ratePercent", ALLOWED_RATES);
  c.cents(form, "additionalWithholdingCents");
}

function compute({ taxYear, wagesCents, form }) {
  const t = TABLES[taxYear];
  validateForm(form);
  const has = onFile(form);
  const ratePercent = has ? form.ratePercent : t.defaultRatePercent;
  if (has && ratePercent === 0) return { stateCents: 0, formBasis: "a-4-zero-election", lines: { ratePercent } };
  const extra = has ? form.additionalWithholdingCents ?? 0 : 0;
  return {
    stateCents: Math.round((wagesCents * ratePercent) / 100) + extra,
    formBasis: has ? "a-4" : "none-on-file-default-2-percent",
    lines: { ratePercent },
  };
}

module.exports = {
  code: "AZ",
  name: "Arizona",
  wageBasis: "federal-income-tax-wages",
  years: Object.keys(TABLES).map(Number),
  TABLES,
  validateForm,
  compute,
};

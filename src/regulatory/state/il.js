// SPDX-License-Identifier: MIT
//
// Illinois income tax withholding: the "automated payroll method" in the
// Illinois Department of Revenue's Booklet IL-700-T:
//   tax = 4.95% x (wages - (Line 1 allowances x exemption + Line 2 allowances x $1,000) / pay periods)
//         + Line 3 additional amount
//
// Wages: Illinois "compensation" is comparable to federal withholding wages
// under IRC 3401(a), and withholding isn't required on amounts not in
// Illinois base income (86 Ill. Adm. Code 100.7010), so pre-tax 401(k)
// deferrals are excluded - the base is federal income-tax wages.
//
// IL-W-4 input: { line1Allowances, line2Allowances, additionalWithholdingCents? }.
// No IL-W-4 on file: withhold on the entire compensation without any
// exemptions (Form IL-W-4 instructions).

const TABLES = Object.freeze({
  2025: Object.freeze({
    rateBp: 495,
    line1AllowanceCents: 2_850_00,
    line2AllowanceCents: 1_000_00,
    sources: Object.freeze([
      "Illinois Booklet IL-700-T (2025): https://tax.illinois.gov/content/dam/soi/en/web/tax/forms/withholding/documents/2025/il-700-t.pdf",
    ]),
  }),
  2026: Object.freeze({
    rateBp: 495,
    line1AllowanceCents: 2_925_00,
    line2AllowanceCents: 1_000_00,
    sources: Object.freeze([
      "Illinois Booklet IL-700-T (2026): https://tax.illinois.gov/content/dam/soi/en/web/tax/forms/withholding/documents/currentyear/il-700-t.pdf",
      "Form IL-W-4 instructions: https://tax.illinois.gov/content/dam/soi/en/web/tax/forms/withholding/documents/currentyear/il-w-4.pdf",
      "86 Ill. Adm. Code 100.7010: https://www.ilga.gov/commission/jcar/admincode/086/086001000S70100R.html",
    ]),
  }),
});

function validateForm(form) {
  if (form === null || form === undefined) return;
  const fail = (m) => {
    throw new Error(`Illinois IL-W-4: ${m}`);
  };
  for (const k of ["line1Allowances", "line2Allowances"]) {
    const v = form[k] ?? 0;
    if (!Number.isInteger(v) || v < 0) fail(`${k} must be a non-negative integer`);
  }
  const extra = form.additionalWithholdingCents ?? 0;
  if (!Number.isSafeInteger(extra) || extra < 0) fail("additionalWithholdingCents must be a non-negative integer");
}

function compute({ taxYear, wagesCents, payPeriodsPerYear, form }) {
  const t = TABLES[taxYear];
  validateForm(form);
  const onFile = form !== null && form !== undefined;
  const line1 = onFile ? form.line1Allowances ?? 0 : 0;
  const line2 = onFile ? form.line2Allowances ?? 0 : 0;
  const extra = onFile ? form.additionalWithholdingCents ?? 0 : 0;

  const exemptions = (line1 * t.line1AllowanceCents + line2 * t.line2AllowanceCents) / payPeriodsPerYear;
  const taxable = Math.max(0, wagesCents - exemptions);
  const stateCents = Math.round((taxable * t.rateBp) / 10_000) + extra;

  return {
    stateCents,
    formBasis: onFile ? "il-w-4" : "none-on-file",
    lines: { exemptions, taxable },
  };
}

module.exports = {
  code: "IL",
  name: "Illinois",
  wageBasis: "federal-income-tax-wages",
  years: Object.keys(TABLES).map(Number),
  TABLES,
  validateForm,
  compute,
};

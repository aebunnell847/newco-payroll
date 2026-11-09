// SPDX-License-Identifier: MIT
//
// Pennsylvania personal income tax withholding: a flat 3.07% of
// compensation. No state withholding certificate or allowances.
//
// Wages: GROSS. Unlike the federal rules, Pennsylvania taxes employee
// 401(k) elective deferrals when they're made - "payments by employers into
// pension plans, 401(k) plans or other retirement plans made pursuant to
// the employee's election ... are taxable to employees and should be
// included in Pennsylvania gross wages" (REV-415).
//
// Not covered: Pennsylvania local earned income tax (EIT) and Local
// Services Tax, which are collected for municipalities and school
// districts, and reciprocity for residents of neighboring states.

const TABLES = Object.freeze({
  2025: Object.freeze({
    rateBp: 307,
    sources: Object.freeze([
      "PA Department of Revenue, General Information for Withholding (REV-415): https://www.pa.gov/content/dam/copapwp-pagov/en/revenue/documents/formsandpublications/formsforbusinesses/employerwithholding/documents/rev-415.pdf",
    ]),
  }),
  2026: Object.freeze({
    rateBp: 307,
    sources: Object.freeze([
      "PA Department of Revenue, Employer Withholding: https://www.pa.gov/agencies/revenue/resources/tax-types-and-information/employer-withholding",
      "PA Department of Revenue, General Information for Withholding (REV-415): https://www.pa.gov/content/dam/copapwp-pagov/en/revenue/documents/formsandpublications/formsforbusinesses/employerwithholding/documents/rev-415.pdf",
    ]),
  }),
});

function validateForm(form) {
  if (form !== null && form !== undefined) {
    throw new Error("Pennsylvania has no state withholding certificate; stateW4 must be null for PA");
  }
}

function compute({ taxYear, wagesCents, form }) {
  validateForm(form);
  return {
    stateCents: Math.round((wagesCents * TABLES[taxYear].rateBp) / 10_000),
    formBasis: "no-form-required",
    lines: {},
  };
}

module.exports = {
  code: "PA",
  name: "Pennsylvania",
  wageBasis: "gross",
  years: Object.keys(TABLES).map(Number),
  TABLES,
  validateForm,
  compute,
};

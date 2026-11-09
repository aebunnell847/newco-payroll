// SPDX-License-Identifier: MIT
//
// States with no individual income tax on wages, so nothing to withhold.
// Each is cited to the state's own revenue agency and listed by year:
// a state's status is a fact about a year, not a permanent one.
// Washington, for example, has enacted a 9.9% tax on individual income over
// $1 million starting January 1, 2028 (SB 6346), so it is listed only for
// 2025-2026 here.
//
// Not covered yet: AK, NV, NH, SD, TN, WY - add each with its own source.

function noTaxState(code, name, years, sources) {
  return Object.freeze({
    code,
    name,
    wageBasis: "none",
    years,
    sources: Object.freeze(sources),
    validateForm(form) {
      if (form !== null && form !== undefined) {
        throw new Error(`${name} has no state income tax; stateW4 must be null for ${code}`);
      }
    },
    compute({ form }) {
      this.validateForm(form);
      return { stateCents: 0, formBasis: "no-state-income-tax", lines: {} };
    },
  });
}

module.exports = [
  noTaxState("TX", "Texas", [2025, 2026], [
    "Texas Comptroller, Property Tax Cuts as Large as Texas (Fiscal Notes, Dec. 2023): https://comptroller.texas.gov/economy/fiscal-notes/archive/2023/dec/proptax.php",
  ]),
  noTaxState("FL", "Florida", [2025, 2026], [
    "Florida Department of Revenue, Do I have to file a personal income tax return in Florida?: https://floridarevenue.com/faq/Pages/FAQDetails.aspx?FAQID=1466",
  ]),
  noTaxState("WA", "Washington", [2025, 2026], [
    "Washington Department of Revenue, Income tax: https://dor.wa.gov/taxes-rates/income-tax",
  ]),
];

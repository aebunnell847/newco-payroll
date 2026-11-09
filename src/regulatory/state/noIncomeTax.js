// SPDX-License-Identifier: MIT
//
// States with no individual income tax on wages, so nothing to withhold.
// Each is cited to the state's own revenue agency and listed by year:
// a state's status is a fact about a year, not a permanent one.
// Washington, for example, has enacted a 9.9% tax on individual income over
// $1 million starting January 1, 2028 (SB 6346), so it is listed only for
// 2025-2026 here.
//
// New Hampshire and Tennessee never taxed wages; each had a tax on interest
// and dividends only (NH's repealed for periods beginning on or after
// Jan. 1, 2025; TN's Hall tax for periods beginning on or after Jan. 1, 2021).

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
  noTaxState("AK", "Alaska", [2025, 2026], [
    "Alaska Department of Revenue, Tax Division Annual Report (history: 1980 repeal of the individual income tax in AS 43.20): https://tax.alaska.gov/programs/programs/reports/AnnualReport.aspx?Year=2023",
  ]),
  noTaxState("NH", "New Hampshire", [2025, 2026], [
    "NH Department of Revenue Administration, Interest & Dividends Tax Repeal: https://www.revenue.nh.gov/news-and-media/interest-dividends-tax-repeal",
    "State of New Hampshire ACFR FY2025 (no personal earned income tax): https://www.das.nh.gov/accounting/FY%2025/FY_2025_Annual_Comprehensive_Financial_Report.pdf",
  ]),
  noTaxState("NV", "Nevada", [2025, 2026], [
    "Nevada Department of Taxation, Income Tax in Nevada: https://tax.nv.gov/about-nevada-department-of-taxation/income-tax-in-nevada/",
  ]),
  noTaxState("SD", "South Dakota", [2025, 2026], [
    "South Dakota Department of Revenue, Taxes: https://dor.sd.gov/individuals/taxes/",
  ]),
  noTaxState("TN", "Tennessee", [2025, 2026], [
    "Tennessee Department of Revenue, GEN-34 Income Tax Withholding: https://revenue.support.tn.gov/hc/en-us/articles/360057595051-GEN-34-Income-Tax-Withholding",
  ]),
  noTaxState("WY", "Wyoming", [2025, 2026], [
    "State of Wyoming, About Wyoming: https://www.wyo.gov/about-wyoming",
  ]),
  noTaxState("WA", "Washington", [2025, 2026], [
    "Washington Department of Revenue, Income tax: https://dor.wa.gov/taxes-rates/income-tax",
  ]),
];

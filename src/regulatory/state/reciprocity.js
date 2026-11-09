// SPDX-License-Identifier: MIT
//
// State income tax reciprocity agreements. Under one, a resident of state R
// working in state W owes W no income tax on wages; W's employer stops
// withholding W tax once the employee files W's nonresidence certificate,
// and withholds R's tax instead. Each entry is keyed by the WORK state and
// cited to that state's own publication.
//
// What this doesn't cover:
// - The agreements' individual conditions are recorded as notes (Virginia's
//   daily-commuting test for Kentucky residents, Maryland's 183-day abode
//   rule, Kentucky's 20% shareholder exclusion for Ohio residents, Minnesota
//   and North Dakota's annual certificates). The employee's certificate is
//   the employer's evidence they're met; this module trusts a certificate
//   on file and doesn't re-test the conditions.
// - Local taxes: reciprocity is state-only. Indiana county tax for a county
//   of principal employment still applies, and so do other work-state local
//   taxes (computeStateWithholdingCents keeps them).
// - Resident-state credits when there is NO agreement (an employee who
//   lives in one state and works in another without reciprocity owes both;
//   only the work state is withheld here).
// - DC: the District has reciprocity with every state, but this engine has
//   no DC withholding rules yet, so a DC resident's home-state tax can't be
//   withheld (the result says so).

const AGREEMENTS = Object.freeze({
  IA: Object.freeze({
    residents: ["IL"],
    certificate: "IA 44-016, Employee's Statement of Nonresidence in Iowa",
    source: "Iowa DOR, Iowa - Illinois Reciprocal Agreement: https://revenue.iowa.gov/taxes/tax-guidance/individual-income-tax/iowa-illinois-reciprocal-agreement",
  }),
  IL: Object.freeze({
    residents: ["IA", "KY", "MI", "WI"],
    certificate: "IL-W-5-NR, Employee's Statement of Nonresidence in Illinois",
    source: "Illinois DOR, Publication 130 (reciprocal agreements with Iowa, Kentucky, Michigan and Wisconsin): https://tax.illinois.gov/content/dam/soi/en/web/tax/research/publications/pubs/documents/pub-130.pdf",
  }),
  IN: Object.freeze({
    residents: ["KY", "MI", "OH", "PA", "WI"],
    certificate: "WH-47, Certificate of Residence",
    note: "Indiana county tax for a county of principal employment still applies (reciprocity covers state tax only).",
    source: "Indiana DOR, Information Bulletin #33, Withholding Requirements for Nonresident Employees: https://www.in.gov/dor/files/ib33.pdf",
  }),
  KY: Object.freeze({
    residents: ["IL", "IN", "MI", "OH", "VA", "WI", "WV"],
    certificate: "K-4 (box 4: works in Kentucky and resides in a reciprocal state)",
    note: "Virginia residents qualify only if they commute daily; Ohio residents only if not a 20%-or-greater shareholder-employee of an S corporation (42A003).",
    source: "Kentucky DOR, 42A003 Withholding Kentucky Income Tax Instructions for Employers (Mar. 2026): https://revenue.ky.gov/Forms/42A003-March%202026.pdf",
  }),
  MD: Object.freeze({
    residents: ["DC", "PA", "VA", "WV"],
    certificate: "MW507 (line 4 for DC, Virginia and West Virginia residents; line 5 for Pennsylvania residents)",
    note: "DC, Pennsylvania and Virginia residents qualify only if they don't keep a Maryland abode for 183 days or more; West Virginia residents have no time limit.",
    source: "Comptroller of Maryland, Form MW507 (2026) instructions: https://www.marylandcomptroller.gov/content/dam/mdcomp/tax/forms/2026/mw507.pdf",
  }),
  MI: Object.freeze({
    residents: ["IL", "IN", "KY", "MN", "OH", "WI"],
    certificate: "MI-W4 (claiming exemption as a resident of a reciprocal state)",
    source: "Michigan Treasury, Form 446 2026 Michigan Income Tax Withholding Guide, Reciprocal Agreements: https://www.michigan.gov/taxes/-/media/Project/Websites/taxes/Forms/SUW/TY2026/446_Withholding-Guide_2026.pdf",
  }),
  MN: Object.freeze({
    residents: ["MI", "ND"],
    certificate: "MWR, Reciprocity Exemption/Affidavit of Residency (each year)",
    note: "Minnesota encourages, but doesn't require, withholding the residence state's tax as a courtesy.",
    source: "Minnesota DOR, 2026 Withholding Instruction Booklet, Reciprocity for Residents of Michigan or North Dakota: https://www.revenue.state.mn.us/sites/default/files/2025-12/wh-inst-26.pdf",
  }),
  MT: Object.freeze({
    residents: ["ND"],
    certificate: "MW-4 (North Dakota resident exemption)",
    source: "Montana DOR, Employer and Information Agent Guide (2026), North Dakota Residents Reciprocity: https://revenuefiles.mt.gov/files/Forms/Montana_Employer_and_Information_Agent_Guide_with_Tax_Tables.pdf",
  }),
  ND: Object.freeze({
    residents: ["MN", "MT"],
    certificate: "NDW-R, Reciprocity Exemption from Withholding (each year)",
    note: "Minnesota residents must return home at least once a month to qualify.",
    source: "ND Office of State Tax Commissioner, Income Tax Withholding & Information Returns guideline: https://www.tax.nd.gov/sites/www/files/documents/guidelines/business/it-withhold/income-tax-withholding-information-returns-guideline.pdf",
  }),
  NJ: Object.freeze({
    residents: ["PA"],
    certificate: "NJ-165, Employee's Certificate of Nonresidence in New Jersey",
    source: "NJ Division of Taxation, NJ-WT (Sept. 2025), New Jersey and Pennsylvania Reciprocal Agreement: https://www.nj.gov/treasury/taxation/pdf/current/njwt.pdf",
  }),
  OH: Object.freeze({
    residents: ["IN", "KY", "MI", "PA", "WV"],
    certificate: "IT 4, section III (statement of residency in a reciprocity state)",
    note: "Not available to nonresident investors holding 20% or more of a pass-through entity with Ohio nexus.",
    source: "Ohio Department of Taxation, Ohio IT 4 (combined; replaces IT 4NR): https://tax.ohio.gov/static/forms/employer_withholding/generic/wth-it4-combined.pdf",
  }),
  PA: Object.freeze({
    residents: ["IN", "MD", "NJ", "OH", "VA", "WV"],
    certificate: "REV-419, Employee's Nonwithholding Application Certificate",
    source: "PA DOR, REV-415 General Information for Withholding, Reciprocal Tax Agreements: https://www.pa.gov/content/dam/copapwp-pagov/en/revenue/documents/formsandpublications/formsforbusinesses/employerwithholding/documents/rev-415.pdf",
  }),
  VA: Object.freeze({
    residents: ["DC", "KY", "MD", "PA", "WV"],
    certificate: "VA-4 (claiming exemption under a reciprocity agreement)",
    note: "Conditions differ by state (e.g. daily commuting for Kentucky and West Virginia residents; no Virginia abode for 183 days or more for DC, Maryland and Pennsylvania residents).",
    source: "Virginia Tax, Income Tax Withholding Guide for Employers, Payments to Nonresidents under Reciprocity Agreements: https://www.tax.virginia.gov/sites/default/files/vatax-pdf/employer-withholding-instructions.pdf",
  }),
  WI: Object.freeze({
    residents: ["IL", "IN", "KY", "MI"],
    certificate: "W-220, Nonresident Employee's Withholding Reciprocity Declaration",
    source: "Wisconsin DOR, Publication W-166 (1/26), Reciprocity: https://www.revenue.wi.gov/DOR%20Publications/pb166.pdf",
  }),
  WV: Object.freeze({
    residents: ["KY", "MD", "OH", "PA", "VA"],
    certificate: "WV/IT-104 NR, Certificate of Nonresidence",
    note: "Pennsylvania and Virginia residents who spend more than 183 days in West Virginia are West Virginia residents.",
    source: "West Virginia Tax Division, WV/IT-104 Employee's Withholding Exemption Certificate: https://tax.wv.gov/Documents/Withholding/it104.pdf",
  }),
});

/** The agreement covering a resident of residenceState working in workState, or null. */
function reciprocityFor(workState, residenceState) {
  if (!workState || !residenceState || workState === residenceState) return null;
  const a = AGREEMENTS[workState];
  return a && a.residents.includes(residenceState) ? a : null;
}

module.exports = { AGREEMENTS, reciprocityFor };

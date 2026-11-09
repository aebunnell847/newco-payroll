// Plain-English overview: local taxes withheld alongside state tax - the
// Oregon statewide transit tax, the Yonkers nonresident earnings tax and
// Denver's occupational privilege tax.

const { expect } = require("chai");
const { computeStateWithholdingCents } = require("../src/regulatory/state");
const ny = require("../src/regulatory/state/ny");

const state = (args) =>
  computeStateWithholdingCents({ taxYear: 2026, payDate: "2026-11-06", federalWithholdingCents: 0, ...args });

describe("Oregon statewide transit tax (0.1%)", () => {
  it("is withheld on OR wages alongside income tax", () => {
    const r = state({ state: "OR", grossPayCents: 2_000_00, federalTaxableWagesCents: 1_900_00, payPeriodsPerYear: 26, form: { filingStatus: "single", allowances: 1 }, federalWithholdingCents: 150_00 });
    expect(r.localities).to.deep.equal({ OR_STT: 1_90 });
    expect(r.localCents).to.equal(1_90);
  });
  it("still applies with no OR-W-4 (8% income tax) and with an exemption from income tax withholding", () => {
    expect(state({ state: "OR", grossPayCents: 1_000_00, federalTaxableWagesCents: 1_000_00, payPeriodsPerYear: 52 }).localities.OR_STT).to.equal(1_00);
    expect(state({ state: "OR", grossPayCents: 1_000_00, federalTaxableWagesCents: 1_000_00, payPeriodsPerYear: 52, form: { exempt: true } }).localities.OR_STT).to.equal(1_00);
  });
});

describe("Yonkers nonresident earnings tax (NYS-50-T-Y Method VIII)", () => {
  const nyAt = (wagesCents, payPeriodsPerYear, form) => ny.compute({ taxYear: 2026, wagesCents, payPeriodsPerYear, form });
  const base = { filingStatus: "single", stateAllowances: 0 };

  it("booklet example: $400 semimonthly -> $9,600 - $3,000 = $6,600 x 0.5% / 24 = $1.38", () =>
    expect(nyAt(400_00, 24, { ...base, worksInYonkers: true }).localities).to.deep.equal({ YONKERS_NR: 1_38 }));
  it("nothing under $4,000 a year; no exclusion over $30,000", () => {
    expect(nyAt(150_00, 26, { ...base, worksInYonkers: true }).localities).to.deep.equal({ YONKERS_NR: 0 });
    expect(nyAt(2_000_00, 26, { ...base, worksInYonkers: true }).localities.YONKERS_NR).to.equal(Math.round((52_000_00 * 0.005) / 26));
  });
  it("a Yonkers resident pays the resident surcharge instead", () => {
    const r = nyAt(2_000_00, 26, { ...base, yonkersResident: true, worksInYonkers: true });
    expect(Object.keys(r.localities)).to.deep.equal(["YONKERS"]);
  });
});

describe("Denver occupational privilege tax ($5.75 a month at $500)", () => {
  const coForm = { denverWorker: true };

  it("withholds once a month, on the first paycheck that brings the month to $500", async () => {
    const { openPayrollStore } = require("../src/data/payrollStore");
    const { runStoredPayroll } = require("../src/payroll/storedPayrollRun");
    const store = openPayrollStore();
    try {
      store.upsertEmployee({ id: "den-1", payType: "salary", annualSalaryCents: 15_600_00, payPeriodsPerYear: 52, workState: "CO", stateW4: coForm });
      const weeks = [["W1", "2026-11-06"], ["W2", "2026-11-13"], ["W3", "2026-11-20"], ["D1", "2026-12-04"]];
      const opt = [];
      for (const [id, payDate] of weeks) {
        store.createPayPeriod({ id, periodStart: payDate, periodEnd: payDate, payDate });
        await runStoredPayroll(store, id);
        opt.push(store.getResult("den-1", id).localWithholding?.DENVER_OPT ?? 0);
      }
      // $300 a week: Nov 6 ($300), Nov 13 ($600 -> withhold), Nov 20 (done), Dec 4 ($300)
      expect(opt).to.deep.equal([0, 5_75, 0, 0]);
    } finally {
      store.close();
    }
  });

  it("skips an employee who gave this employer a TD269; needs month-to-date otherwise", () => {
    const args = { state: "CO", grossPayCents: 1_000_00, federalTaxableWagesCents: 1_000_00, payPeriodsPerYear: 52 };
    expect(state({ ...args, form: { ...coForm, denverTd269: true } }).localCents).to.equal(0);
    expect(() => state({ ...args, form: coForm })).to.throw(/month-to-date pay is required/);
    expect(state({ ...args, form: coForm, monthToDate: { grossCents: 0, localities: {} } }).localities).to.deep.equal({ DENVER_OPT: 5_75 });
  });

  it("Denver flags alone don't count as a DR 0004", () => {
    const r = state({ state: "CO", grossPayCents: 1_000_00, federalTaxableWagesCents: 1_000_00, payPeriodsPerYear: 52, form: coForm, monthToDate: { grossCents: 0, localities: {} } });
    expect(r.formBasis).to.equal("none-on-file-single");
  });
});

// Plain-English overview: state reciprocity agreements - a resident of one
// state working in a reciprocal state, with the work state's nonresidence
// certificate on file, has the HOME state's tax withheld instead.

const { expect } = require("chai");
const { AGREEMENTS, reciprocityFor } = require("../src/regulatory/state/reciprocity");
const { computeTaxWithholdingCents } = require("../src/payroll/payrollEngine");
const { computeStateWithholdingCents } = require("../src/regulatory/state");

const base = { taxYear: 2026, grossPayCents: 2_000_00, payPeriodsPerYear: 26, payDate: "2026-11-13" };

describe("reciprocity agreements (each cited to the work state)", () => {
  it("every agreement is listed by both states (DC aside: no DC rules here)", () => {
    for (const [work, a] of Object.entries(AGREEMENTS)) {
      for (const home of a.residents) {
        if (home === "DC") continue;
        expect(AGREEMENTS[home]?.residents ?? [], `${work} lists ${home}, so ${home} should list ${work}`).to.include(work);
      }
    }
  });

  it("knows the published pairs", () => {
    expect(reciprocityFor("NJ", "PA").certificate).to.match(/NJ-165/);
    expect(reciprocityFor("PA", "NJ").certificate).to.match(/REV-419/);
    expect(reciprocityFor("IL", "IN")).to.equal(null); // Indiana dropped Illinois; Illinois lists IA, KY, MI, WI
    expect(reciprocityFor("NY", "NJ")).to.equal(null);
    expect(reciprocityFor("OH", "OH")).to.equal(null);
  });
});

describe("withholding under reciprocity", () => {
  it("a PA resident working in NJ with an NJ-165: PA's 3.07%, no NJ tax", () => {
    const r = computeTaxWithholdingCents({ ...base, workState: "NJ", residenceState: "PA", reciprocityCertificate: true });
    expect(r.state).to.equal("PA");
    expect(r.stateCents).to.equal(Math.round(2_000_00 * 0.0307));
    expect(r.reciprocity).to.include({ workState: "NJ", residenceState: "PA", homeStateWithheld: true });
  });

  it("...where PA's base is gross pay (401(k) included), as REV-415 says", () => {
    const r = computeTaxWithholdingCents({ ...base, preTaxDeductionsCents: 100_00, workState: "NJ", residenceState: "PA", reciprocityCertificate: true });
    expect(r.stateCents).to.equal(Math.round(2_000_00 * 0.0307));
  });

  it("without the certificate, the work state withholds as usual", () => {
    const r = computeTaxWithholdingCents({ ...base, workState: "NJ", residenceState: "PA", reciprocityCertificate: false });
    const nj = computeStateWithholdingCents({ state: "NJ", taxYear: 2026, grossPayCents: 2_000_00, federalTaxableWagesCents: 2_000_00, payPeriodsPerYear: 26 });
    expect(r.state).to.equal("NJ");
    expect(r.stateCents).to.equal(nj.stateCents);
    expect(r.reciprocity).to.equal(null);
  });

  it("uses the home state's certificate (an OH resident in MI with an IT 4)", () => {
    const r = computeTaxWithholdingCents({
      ...base,
      workState: "MI",
      stateW4: { exemptions: 0 },
      residenceState: "OH",
      residenceStateW4: { exemptions: 1, schoolDistrict: "2514" },
      reciprocityCertificate: true,
    });
    expect(r.state).to.equal("OH");
    expect(r.stateFormBasis).to.equal("reciprocity-it-4");
    expect(r.localities).to.have.property("OH_SD_2514"); // the home school district's tax comes along
  });

  it("keeps work-state local tax: a KY resident in IN still owes the IN county of employment", () => {
    const r = computeTaxWithholdingCents({
      ...base,
      workState: "IN",
      stateW4: { personalExemptions: 1, countyOfResidence: null, countyOfPrincipalEmployment: "49" },
      residenceState: "KY",
      reciprocityCertificate: true,
    });
    expect(r.state).to.equal("KY");
    expect(r.localities).to.have.property("IN-49");
  });

  it("refuses a certificate no agreement covers", () => {
    expect(() => computeTaxWithholdingCents({ ...base, workState: "NJ", residenceState: "NY", reciprocityCertificate: true })).to.throw(
      /no reciprocity agreement covers a NY resident working in NJ/
    );
  });

  it("is stored with the employee and on the result (state_code)", async () => {
    const { openPayrollStore } = require("../src/data/payrollStore");
    const { runStoredPayroll } = require("../src/payroll/storedPayrollRun");
    const store = openPayrollStore();
    try {
      store.upsertEmployee({ id: "pa-nj", payType: "salary", annualSalaryCents: 52_000_00, payPeriodsPerYear: 26, workState: "NJ", residenceState: "PA", reciprocityCertificate: true });
      expect(() =>
        store.upsertEmployee({ id: "bad", payType: "salary", annualSalaryCents: 1, payPeriodsPerYear: 26, workState: "NJ", residenceState: "NY", reciprocityCertificate: true })
      ).to.throw(/no reciprocity agreement/);
      store.createPayPeriod({ id: "P23", periodStart: "2026-10-26", periodEnd: "2026-11-08", payDate: "2026-11-13" });
      await runStoredPayroll(store, "P23");
      const res = store.getResult("pa-nj", "P23");
      expect(res.stateCode).to.equal("PA");
      expect(res.stateWithholdingCents).to.equal(Math.round(2_000_00 * 0.0307));
    } finally {
      store.close();
    }
  });
});

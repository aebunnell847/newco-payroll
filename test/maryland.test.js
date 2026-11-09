// Plain-English overview: Maryland state + county withholding from the
// Comptroller's 2026 percentage-method tables (one per local rate).

const { expect } = require("chai");
const md = require("../src/regulatory/state/md");

const at = (wagesCents, payPeriodsPerYear, form = null) =>
  md.compute({ taxYear: 2026, wagesCents, payPeriodsPerYear, form });

describe("Maryland (2026 percentage method, generated tables)", () => {
  const t = md.TABLES[2026];

  it("has all nine local tables, seven periods each", () => {
    expect(Object.keys(t.rateTables).sort()).to.deep.equal(["225", "240", "265", "275", "300", "305", "310", "320", "330"]);
    for (const tab of Object.values(t.rateTables)) {
      expect(Object.keys(tab).sort()).to.deep.equal(["annual", "biweekly", "daily", "monthly", "quarterly", "semimonthly", "weekly"]);
    }
  });

  it("every rate is Maryland's state marginal rate plus the local rate", () => {
    const state = [475, 500, 525, 550, 575, 625, 650];
    for (const [code, tab] of Object.entries(t.rateTables)) {
      for (const p of Object.values(tab)) {
        for (const s of ["joint", "single"]) expect(p[s].map((r) => r[2]), `${code}`).to.deep.equal(state.map((x) => x + Number(code)));
      }
    }
  });

  it("every base follows from the bracket below it (printed edges are rounded)", () => {
    for (const tab of Object.values(t.rateTables)) {
      for (const p of Object.values(tab)) {
        for (const rows of [p.joint, p.single]) {
          for (let i = 1; i < rows.length; i++) {
            const [o0, b0, r0] = rows[i - 1];
            expect(Math.abs(b0 + ((rows[i][0] - o0) * r0) / 10_000 - rows[i][1])).to.be.at.most(15);
          }
        }
      }
    }
  });

  it("matches the printed exemption and standard-deduction amounts", () => {
    const p = t.rateTables["320"];
    expect([p.weekly.exemptionCents, p.weekly.standardDeductionCents]).to.deep.equal([61_54, 65_38]);
    expect([p.annual.exemptionCents, p.annual.standardDeductionCents]).to.deep.equal([3_200_00, 3_400_00]);
    expect([p.daily.exemptionCents, p.daily.standardDeductionCents]).to.deep.equal([8_77, 9_31]);
  });

  it("$1,000 weekly, Baltimore City, single, 1 exemption: ($1,000 - $65.38 - $61.54) x 7.95%", () => {
    const r = at(1_000_00, 52, { county: "baltimoreCity", filingStatus: "single", exemptions: 1 });
    expect(r.lines.localRateBp).to.equal(320);
    expect(r.stateCents).to.equal(Math.round(87_308 * 0.0795));
  });

  it("tiered counties pick the table for the employee's annualized taxable income", () => {
    const aa = (w, s) => at(w, 52, { county: "anneArundel", filingStatus: s, exemptions: 1 }).lines.localRateBp;
    expect(aa(1_000_00, "single")).to.equal(275); // $45,400 a year
    expect(aa(1_200_00, "single")).to.equal(300); // over $50,000
    expect(aa(1_200_00, "married")).to.equal(275); // joint tier runs to $75,000
    const fr = (w) => at(w, 52, { county: "frederick", filingStatus: "married", exemptions: 2 }).lines.localRateBp;
    expect(fr(5_000_00)).to.equal(320); // $250,200 a year
    expect(fr(400_00)).to.equal(225);
  });

  it("nonresidents use the nonresident (2.25% special) table; Delaware workers aren't supported yet", () => {
    expect(at(1_000_00, 52, { county: "nonresident", filingStatus: "single", exemptions: 1 }).lines.localRateBp).to.equal(225);
    expect(() => at(1_000_00, 52, { county: "delaware", filingStatus: "single", exemptions: 1 })).to.throw(/Delaware table/);
  });

  it("withholds nothing under the floor; no MW507: single, none, highest local table", () => {
    expect(at(95_00, 52, { county: "howard", filingStatus: "single", exemptions: 0 }).stateCents).to.equal(0);
    const r = at(1_000_00, 52);
    expect(r.formBasis).to.equal("none-on-file-single-zero-highest-local");
    expect(r.lines.localRateBp).to.equal(330);
  });
});

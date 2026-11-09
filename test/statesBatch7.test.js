// Plain-English overview: New Mexico and Ohio withholding, checked against
// each agency's worked example or printed tables.

const { expect } = require("chai");
const nm = require("../src/regulatory/state/nm");
const oh = require("../src/regulatory/state/oh");

const at = (m, wagesCents, payPeriodsPerYear, form = null, extra = {}) =>
  m.compute({ taxYear: 2026, wagesCents, payPeriodsPerYear, form, payDate: "2026-11-06", ...extra });

describe("New Mexico (FYI-104, 2026, generated tables)", () => {
  it("FYI-104 example: $1,000 weekly, married, $20 extra -> $41.80", () =>
    expect(at(nm, 1_000_00, 52, { filingStatus: "married", additionalWithholdingCents: 20_00 }).stateCents).to.equal(41_80));
  it("has single, married and head-of-household tables for all eight periods", () => {
    const t = nm.TABLES[2026].percentageTables;
    expect(Object.keys(t).sort()).to.deep.equal(["annual", "biweekly", "daily", "monthly", "quarterly", "semiannual", "semimonthly", "weekly"]);
    expect(t.annual.single[1][0]).to.equal(8_050_00);
    expect(t.annual.married[1][0]).to.equal(16_100_00);
    expect(t.annual.headOfHousehold[1][0]).to.equal(12_075_00);
  });
  it("uses the federal W-4's filing status when there's no New Mexico copy; none -> single", () => {
    expect(at(nm, 1_000_00, 52, null, { federalW4: { formYear: 2024, filingStatus: "headOfHousehold" } }).lines.status).to.equal("headOfHousehold");
    expect(at(nm, 1_000_00, 52).formBasis).to.equal("none-on-file-single");
  });
});

describe("Ohio (Percentage Method, effective August 1, 2026)", () => {
  it("reproduces every printed edge, base and exemption amount", () => {
    const t = oh.TABLES[2026];
    const printed = {
      weekly: [12_50, 500_96, 8_02, 1_923_08, 50_54],
      biweekly: [25_00, 1_001_92, 16_03, 3_846_15, 101_07],
      semimonthly: [27_08, 1_085_42, 17_37, 4_166_67, 109_50],
      monthly: [54_17, 2_170_83, 34_73, 8_333_33, 218_99],
      daily: [2_50, 100_19, 1_60, 384_62, 10_10],
    };
    for (const [p, [ex, e1, b1, e2, b2]] of Object.entries(printed)) {
      const { exemptionCents, rows } = oh.periodTable(t, p);
      expect([exemptionCents, rows[1][0], rows[1][1], rows[2][0], rows[2][1]], p).to.deep.equal([ex, e1, b1, e2, b2]);
    }
  });
  it("$1,000 weekly, 1 exemption: $987.50 -> $8.02 + 2.99% x $486.54", () =>
    expect(at(oh, 1_000_00, 52, { exemptions: 1 }).stateCents).to.equal(Math.round(8_02 + (98_750 - 50_096) * 0.0299)));
  it("throws for pay dates before August 1, 2026", () =>
    expect(() => at(oh, 1_000_00, 52, null, { payDate: "2026-07-31" })).to.throw(/Ohio withholding for pay date/));
  it("no IT 4: zero exemptions", () => expect(at(oh, 1_000_00, 52).formBasis).to.equal("none-on-file-zero-exemptions"));
});

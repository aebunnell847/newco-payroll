// Plain-English overview: Missouri, North Dakota, Oklahoma, South Carolina
// and Virginia withholding (bracket states), each checked against its own
// agency's worked example and printed figures.

const { expect } = require("chai");
const mo = require("../src/regulatory/state/mo");
const nd = require("../src/regulatory/state/nd");
const ok = require("../src/regulatory/state/ok");
const sc = require("../src/regulatory/state/sc");
const va = require("../src/regulatory/state/va");

const at = (m, wagesCents, payPeriodsPerYear, form = null, extra = {}) =>
  m.compute({ taxYear: 2026, wagesCents, payPeriodsPerYear, form, payDate: "2026-11-06", ...extra });

describe("Missouri (2026 withholding formula)", () => {
  it("formula example: $35,000 a year, married spouse works -> $707.81 a year, $59 a month", () => {
    expect(at(mo, 35_000_00, 1, { filingStatus: "single" }).lines.annualTaxCents).to.be.closeTo(707_81, 0.5);
    expect(at(mo, Math.round(35_000_00 / 12), 12, { filingStatus: "single" }).stateCents).to.equal(59_00);
  });
  it("standard deductions: $16,100 / $32,200 spouse doesn't work / $24,150 head of household", () => {
    expect(at(mo, 32_200_00, 1, { filingStatus: "marriedSpouseDoesNotWork" }).stateCents).to.equal(0);
    expect(at(mo, 24_150_00, 1, { filingStatus: "headOfHousehold" }).stateCents).to.equal(0);
    expect(at(mo, 24_150_00, 1, { filingStatus: "single" }).stateCents).to.be.greaterThan(0);
  });
  it("no MO W-4: single; line 3 reduced withholding replaces the calculation", () => {
    expect(at(mo, 3_000_00, 12).formBasis).to.equal("none-on-file-single");
    expect(at(mo, 3_000_00, 12, { filingStatus: "single", reducedWithholdingCents: 10_00 }).stateCents).to.equal(10_00);
  });
});

describe("North Dakota (2026 booklet; federal W-4)", () => {
  it("Section 2 worksheet: $1,800 weekly single -> $701.51 a year, $13 (the booklet's $734 / $14 used the 2025 threshold)", () => {
    const r = at(nd, 1_800_00, 52, null, { federalW4: { formYear: 2024, filingStatus: "single" } });
    expect(r.lines.annualTaxCents).to.be.closeTo(701_51, 0.5);
    expect(r.stateCents).to.equal(13_00);
  });
  it("each table's top base follows from the bracket below it", () => {
    for (const rows of Object.values(nd.TABLES[2026].annualTables)) {
      expect(Math.round(((rows[2][0] - rows[1][0]) * rows[1][2]) / 10_000)).to.equal(rows[2][1]);
    }
  });
  it("pre-2020 W-4: $5,050 per allowance; no W-4: single", () => {
    const pre = at(nd, 1_800_00, 52, null, { federalW4: { formYear: 2019, maritalStatus: "single", allowances: 2 } });
    expect(pre.lines.taxableAnnualCents).to.equal(93_600_00 - 10_100_00);
    expect(at(nd, 1_800_00, 52).formBasis).to.equal("none-on-file-single");
  });
  it("has no state certificate", () => expect(() => at(nd, 1, 52, {})).to.throw(/stateW4 must be null for ND/));
});

describe("Oklahoma (Packet OW-2 2026, generated tables)", () => {
  it("packet example: $1,825 semimonthly, married, 2 allowances -> $37.00", () => {
    const r = at(ok, 1_825_00, 24, { filingStatus: "married", allowances: 2 });
    expect(r.lines.netCents).to.equal(1_741_66);
    expect(r.stateCents).to.equal(37_00);
  });
  it("has single and married tables for all eight periods, each scaled from the annual table", () => {
    const t = ok.TABLES[2026].percentageTables;
    expect(Object.keys(t).sort()).to.deep.equal(["annual", "biweekly", "daily", "monthly", "quarterly", "semiannual", "semimonthly", "weekly"]);
    expect(t.annual.single.map((r) => r[0])).to.deep.equal([0, 10_100_00, 11_250_00, 13_550_00]);
    expect(t.annual.married.map((r) => r[0])).to.deep.equal([0, 20_200_00, 22_500_00, 27_100_00]);
  });
  it("married-but-single-rate uses the single table; no OK-W-4: single, no allowances", () => {
    expect(at(ok, 1_825_00, 24, { filingStatus: "marriedWithholdAtSingle", allowances: 0 }).lines.status).to.equal("single");
    expect(at(ok, 1_825_00, 24).formBasis).to.equal("none-on-file-single-zero");
  });
});

describe("South Carolina (WH-1603F 2026)", () => {
  it("formula example: $750 weekly, 3 allowances -> $549.90 a year, $10.58 a week", () => {
    const r = at(sc, 750_00, 52, { allowances: 3 });
    expect(r.lines.standardDeductionCents).to.equal(3_900_00);
    expect(r.lines.annualTaxCents).to.equal(549_90);
    expect(r.stateCents).to.equal(10_58);
  });
  it("no standard deduction with zero allowances; capped at $7,500", () => {
    expect(at(sc, 750_00, 52, { allowances: 0 }).lines.standardDeductionCents).to.equal(0);
    expect(at(sc, 5_000_00, 52, { allowances: 1 }).lines.standardDeductionCents).to.equal(7_500_00);
  });
  it("no SC W-4: zero allowances", () => expect(at(sc, 750_00, 52).formBasis).to.equal("none-on-file-zero-allowances"));
});

describe("Virginia (tables for wages paid after July 1, 2025)", () => {
  it("formula example: $2,649 semimonthly, 5 exemptions -> $2,628 a year, $109.50", () => {
    const r = at(va, 2_649_00, 24, { personalExemptions: 5 });
    expect(r.lines.T).to.equal(50_176_00);
    expect(r.lines.W).to.equal(2_628_00);
    expect(r.stateCents).to.equal(109_50);
  });
  it("daily payroll uses P = 300", () => expect(at(va, 200_00, 260).lines.P).to.equal(300));
  it("no VA-4: no exemptions", () => expect(at(va, 2_649_00, 24).formBasis).to.equal("none-on-file-no-exemptions"));
});

// Plain-English overview: 2025 state withholding, each state checked
// against its own 2025 publication's worked examples or printed tables.
// (2026 is tested in the other state test files.)

const { expect } = require("chai");
const { computeStateWithholdingCents } = require("../src/regulatory/state");
const az = require("../src/regulatory/state/az");
const ia = require("../src/regulatory/state/ia");
const ky = require("../src/regulatory/state/ky");
const la = require("../src/regulatory/state/la");
const ms = require("../src/regulatory/state/ms");
const nc = require("../src/regulatory/state/nc");

const at = (m, wagesCents, payPeriodsPerYear, form = null, extra = {}) =>
  m.compute({ taxYear: 2025, wagesCents, payPeriodsPerYear, form, payDate: "2025-06-13", ...extra });

describe("2025: Kentucky (42A003 (TCF)(12-2024): 4%, $3,270)", () => {
  it("monthly example: $3,020 -> $109.90", () => expect(at(ky, 3_020_00, 12).stateCents).to.equal(109_90));
  it("biweekly example: $1,500 -> $54.97", () => expect(at(ky, 1_500_00, 26).stateCents).to.equal(54_97));
});

describe("2025: Iowa (formula effective January 1, 2025: all ten worked examples)", () => {
  const ex = (G, P, form) => at(ia, G, P, { formYear: 2025, ...form }).stateCents;
  it("Ex. 1-3: $2,100 biweekly - other / joint no-earner / head of household", () => {
    expect(ex(2_100_00, 26, { maritalStatus: "other", allowanceCents: 40_00 })).to.equal(60_72);
    expect(ex(2_100_00, 26, { maritalStatus: "marriedJointSpouseNoEarnings", allowanceCents: 80_00 })).to.equal(41_57);
    expect(ex(2_100_00, 26, { maritalStatus: "headOfHousehold", allowanceCents: 160_00 })).to.equal(47_27);
  });
  it("Ex. 4-6: $5,000 monthly", () => {
    expect(ex(5_000_00, 12, { maritalStatus: "other", allowanceCents: 40_00 })).to.equal(148_67);
    expect(ex(5_000_00, 12, { maritalStatus: "marriedJointSpouseNoEarnings", allowanceCents: 80_00 })).to.equal(107_17);
    expect(ex(5_000_00, 12, { maritalStatus: "headOfHousehold", allowanceCents: 160_00 })).to.equal(119_51);
  });
  it("Ex. 7-10: 2023-or-earlier IA W-4 (allowances x $40)", () => {
    const old = (G, P, maritalStatus, allowances) => at(ia, G, P, { formYear: 2023, maritalStatus, allowances }).stateCents;
    expect(old(2_100_00, 26, "single", 1)).to.equal(60_72);
    expect(old(2_100_00, 26, "married", 2)).to.equal(41_57);
    expect(old(5_000_00, 12, "single", 1)).to.equal(148_67);
    expect(old(5_000_00, 12, "married", 2)).to.equal(107_17);
  });
  it("each printed per-period deduction is the annual figure / periods (daily: / 260)", () => {
    const n = { daily: 260, weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12, annual: 1 };
    for (const set of Object.values(ia.TABLES[2025].deductionCents)) {
      for (const col of Object.values(set)) {
        for (const [p, v] of Object.entries(col)) expect(v, p).to.equal(Math.round(col.annual / n[p]));
      }
    }
  });
});

describe("2025: Louisiana (R-1306 1/25)", () => {
  it("Example 1: claiming 1, $700 weekly -> $14.20", () => expect(at(la, 700_00, 52, { deductions: 1 }).stateCents).to.equal(14_20));
  it("Example 2: claiming 2, $4,600 biweekly -> $112.43", () => expect(at(la, 4_600_00, 26, { deductions: 2 }).stateCents).to.equal(112_43));
});

describe("2025: North Carolina (NC-30 2025: 4.35%)", () => {
  it("NC-30 example: $450 weekly, single, 2 allowances -> $5.00", () => {
    expect(at(nc, 450_00, 52, { filingStatus: "single", allowances: 2 }).stateCents).to.equal(5_00);
  });
});

describe("2025: Mississippi (Pub 89-700-24, tables effective January 1, 2025: 4.4%)", () => {
  it("matches the printed biweekly single table, $1,500-$1,520 row, every exemption column", () => {
    const columns = [0, 6_000, 7_500, 9_000, 10_500, 12_000, 13_500, 15_000, 16_500, 18_000];
    const printed = [46, 35, 33, 30, 28, 25, 23, 20, 18, 15];
    const got = columns.map((x) => at(ms, 1_510_00, 26, { status: "single", exemptionCents: x * 100 }).stateCents / 100);
    expect(got).to.deep.equal(printed);
  });
  it("matches the $1,000-$1,020 and $1,880-$1,900 rows", () => {
    const row = (wages, x) => at(ms, wages, 26, { status: "single", exemptionCents: x }).stateCents / 100;
    expect([row(1_010_00, 0), row(1_010_00, 6_000_00)]).to.deep.equal([24, 13]);
    expect([row(1_890_00, 0), row(1_890_00, 6_000_00)]).to.deep.equal([62, 52]);
  });
});

describe("2025: Arizona (A-4 instructions 2025: 2.0% default)", () => {
  it("no A-4: 2.0%", () => expect(at(az, 2_000_00, 26).stateCents).to.equal(40_00));
});

describe("2025 through computeStateWithholdingCents", () => {
  it("picks the 2025 figures by tax year", () => {
    const r = computeStateWithholdingCents({ state: "KY", taxYear: 2025, grossPayCents: 1_500_00, federalTaxableWagesCents: 1_500_00, payPeriodsPerYear: 26 });
    expect(r.stateCents).to.equal(54_97);
  });
});

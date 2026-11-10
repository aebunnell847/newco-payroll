// Plain-English overview: 2025 state withholding, each state checked
// against its own 2025 publication's worked examples or printed tables.
// (2026 is tested in the other state test files.)

const { expect } = require("chai");
const { computeStateWithholdingCents } = require("../src/regulatory/state");
const al = require("../src/regulatory/state/al");
const az = require("../src/regulatory/state/az");
const ia = require("../src/regulatory/state/ia");
const ky = require("../src/regulatory/state/ky");
const la = require("../src/regulatory/state/la");
const me = require("../src/regulatory/state/me");
const mn = require("../src/regulatory/state/mn");
const mo = require("../src/regulatory/state/mo");
const ms = require("../src/regulatory/state/ms");
const nc = require("../src/regulatory/state/nc");
const nd = require("../src/regulatory/state/nd");
const or = require("../src/regulatory/state/or");
const sc = require("../src/regulatory/state/sc");
const wi = require("../src/regulatory/state/wi");

// Each row's base follows from the row below it (to the cent).
const chain = (rows) => {
  for (let i = 2; i < rows.length; i++) {
    const [o0, b0, r0] = rows[i - 1];
    expect(Math.abs(b0 + ((rows[i][0] - o0) * r0) / 10_000 - rows[i][1]), `row ${i}`).to.be.at.most(1);
  }
};

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

describe("2025: Alabama (January 2025 booklet)", () => {
  it("booklet example: M-2, $850 weekly, federal $35.19 -> $29.59", () => {
    expect(at(al, 850_00, 52, { exemption: "M", dependents: 2 }, { federalWithholdingCents: 35_19 }).stateCents).to.equal(29_59);
  });
});

describe("2025: Minnesota (2025 booklet computer formula)", () => {
  it("each chart row's 'Add' follows from the row below", () => {
    chain(mn.TABLES[2025].charts.single);
    chain(mn.TABLES[2025].charts.married);
  });
  it("$5,200 per allowance: $1,000 weekly single, 2 allowances", () => {
    const taxable = 52_000_00 - 10_400_00;
    expect(at(mn, 1_000_00, 52, { filingStatus: "single", allowances: 2 }).stateCents).to.equal(
      Math.round((1_742_50 + (taxable - 37_120_00) * 0.068) / 52)
    );
  });
});

describe("2025: Missouri (2025 withholding formula)", () => {
  it("formula example: $35,000 a year, married spouse works -> $764.02 a year, $64 a month", () => {
    expect(at(mo, 35_000_00, 1, { filingStatus: "single" }).lines.annualTaxCents).to.be.closeTo(764_02, 0.5);
    expect(at(mo, Math.round(35_000_00 / 12), 12, { filingStatus: "single" }).stateCents).to.equal(64_00);
  });
  it("standard deductions: $15,000 / $30,000 / $22,500", () => {
    expect(at(mo, 30_000_00, 1, { filingStatus: "marriedSpouseDoesNotWork" }).stateCents).to.equal(0);
    expect(at(mo, 22_500_00, 1, { filingStatus: "headOfHousehold" }).stateCents).to.equal(0);
  });
});

describe("2025: North Dakota (2025 rates and instructions)", () => {
  it("Section 2 example: $1,800 weekly single -> $733.69 a year (printed $733.00), $14", () => {
    const r = at(nd, 1_800_00, 52, null, { federalW4: { formYear: 2024, filingStatus: "single" } });
    expect(r.lines.annualTaxCents).to.be.closeTo(733_69, 0.5);
    expect(r.stateCents).to.equal(14_00);
  });
  it("Section 1 example (pre-2020 W-4): $1,800 weekly, single, 2 allowances -> $10", () => {
    const r = at(nd, 1_800_00, 52, null, { federalW4: { formYear: 2019, maritalStatus: "single", allowances: 2 } });
    expect(r.stateCents).to.equal(10_00);
  });
  it("each table's top base follows from the bracket below it", () => {
    for (const rows of Object.values(nd.TABLES[2025].annualTables)) chain(rows);
  });
});

describe("2025: Oregon (withholding tax formulas, Rev. 12-10-24)", () => {
  it("Example 1: $25,000 single, $1,000 federal -> BASE $21,165, $1,798 a year", () => {
    const r = at(or, 25_000_00, 1, { filingStatus: "single", allowances: 0 }, { federalWithholdingCents: 1_000_00 });
    expect(r.lines.baseCents).to.equal(21_165_00);
    expect(Math.round(r.lines.annualCents / 100)).to.equal(1_798);
  });
  it("Example 3: $132,000 single -> federal subtraction limited to $5,100", () => {
    const r = at(or, 132_000_00, 1, { filingStatus: "single", allowances: 4 }, { federalWithholdingCents: 21_098_00 });
    expect(r.lines.federalSubtractedCents).to.equal(5_100_00);
  });
});

describe("2025: South Carolina (WH-1603F 2025)", () => {
  it("formula example: $750 weekly, 3 allowances -> $594.88 a year, $11.44 a week", () => {
    const r = at(sc, 750_00, 52, { allowances: 3 });
    expect(r.lines.standardDeductionCents).to.equal(3_900_00);
    expect(r.lines.annualTaxCents).to.equal(594_88);
    expect(r.stateCents).to.equal(11_44);
  });
});

describe("2025: Wisconsin (W-166 6/24 alternate method)", () => {
  it("Example 1: $350 weekly, single, 1 exemption -> $7.59", () =>
    expect(at(wi, 350_00, 52, { filingStatus: "single", exemptions: 1 }).stateCents).to.equal(7_59));
  it("Example 2: $500 weekly, single, 3 exemptions -> $14.34", () =>
    expect(at(wi, 500_00, 52, { filingStatus: "single", exemptions: 3 }).stateCents).to.equal(14_34));
  it("Example 3: $1,000 biweekly, married, 3 exemptions -> $22.08", () =>
    expect(at(wi, 1_000_00, 26, { filingStatus: "married", exemptions: 3 }).stateCents).to.equal(22_08));
});

describe("2025: Maine (2025 withholding tables, percentage method)", () => {
  it("Example 1: $300 weekly, single, 2 allowances -> $0", () =>
    expect(at(me, 300_00, 52, { filingStatus: "single", allowances: 2 }).stateCents).to.equal(0));
  it("Example 2: $1,000 weekly, single, 2 allowances -> $1,740 a year, $33", () => {
    const r = at(me, 1_000_00, 52, { filingStatus: "single", allowances: 2 });
    expect(Math.round(r.lines.annualTaxCents / 100)).to.equal(1_740);
    expect(r.stateCents).to.equal(33_00);
  });
  it("Example 3: $4,500 weekly, married, 2 allowances -> standard deduction $21,005, $13,476 a year, $259", () => {
    const r = at(me, 4_500_00, 52, { filingStatus: "married", allowances: 2 });
    expect(Math.round(r.lines.standardDeductionCents / 100)).to.equal(21_005);
    expect(Math.round(r.lines.annualTaxCents / 100)).to.equal(13_476);
    expect(r.stateCents).to.equal(259_00);
  });
  it("no 2% surcharge before 2026", () => {
    const r = at(me, 50_000_00, 52, { filingStatus: "single", allowances: 0 });
    expect(r.lines.annualTaxCents).to.be.closeTo(4_028_00 + (r.lines.incomeCents - 63_450_00) * 0.0715, 1);
  });
});

describe("2025 through computeStateWithholdingCents", () => {
  it("picks the 2025 figures by tax year", () => {
    const r = computeStateWithholdingCents({ state: "KY", taxYear: 2025, grossPayCents: 1_500_00, federalTaxableWagesCents: 1_500_00, payPeriodsPerYear: 26 });
    expect(r.stateCents).to.equal(54_97);
  });
});

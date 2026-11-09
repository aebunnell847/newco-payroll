// Plain-English overview: five places changed their 2026 withholding figures
// partway through the year. Pay dates before each change use the figures
// that were in force then, checked here against those earlier documents'
// own printed tables and worked examples:
//   Georgia  before May 11  - original 2026 Employer's Tax Guide (5.19%)
//   Idaho    before Jul. 23 - EPB00744 (04-28-2025) + the child tax credit allowance table
//   Utah     before Jun. 1  - Publication 14, Rev. 4/25 (4.5%)
//   Ohio     before Aug. 1  - Percentage Method effective Oct. 1, 2025
//   Indiana  Boone County before Oct. 1 - 0.017 (Departmental Notice #1, R46 / 01-26)

const { expect } = require("chai");
const { computeStateWithholdingCents } = require("../src/regulatory/state");
const ga = require("../src/regulatory/state/ga");
const id = require("../src/regulatory/state/id");
const ind = require("../src/regulatory/state/in");
const oh = require("../src/regulatory/state/oh");
const ut = require("../src/regulatory/state/ut");

const at = (m, payDate, wagesCents, payPeriodsPerYear, form = null, extra = {}) =>
  m.compute({ taxYear: 2026, wagesCents, payPeriodsPerYear, form, payDate, ...extra });

describe("Georgia before May 11, 2026 (original 2026 Employer's Tax Guide)", () => {
  const early = ga.TABLES[2026].earlier[0];

  it("reproduces every printed Table F figure", () => {
    const periods = ["weekly", "biweekly", "semimonthly", "monthly", "quarterly", "semiannual", "annual", "daily"];
    const printed = {
      joint: [461_54, 923_08, 1_000_00, 2_000_00, 6_000_00, 12_000_00, 24_000_00, 65_75],
      single: [230_77, 461_54, 500_00, 1_000_00, 3_000_00, 6_000_00, 12_000_00, 32_88],
      dependent: [76_92, 153_85, 166_67, 333_33, 1_000_00, 2_000_00, 4_000_00, 10_96],
    };
    expect(periods.map((p) => ga.perPeriod(early.annualStandardDeductionCents.joint, p))).to.deep.equal(printed.joint);
    expect(periods.map((p) => ga.perPeriod(early.annualStandardDeductionCents.single, p))).to.deep.equal(printed.single);
    expect(periods.map((p) => ga.perPeriod(early.annualAllowanceCents, p))).to.deep.equal(printed.dependent);
  });

  it("Guide example: married, spouse not working, semimonthly $1,470.83, one child -> $15.79", () => {
    const r = at(ga, "2026-03-13", 1_470_83, 24, { maritalStatus: "C", dependentAllowances: 1, adjustmentAllowances: 0 });
    expect(r.stateCents).to.equal(15_79);
  });

  it("Guide example: head of household, biweekly $730.77, two children -> $0", () => {
    expect(at(ga, "2026-03-13", 730_77, 26, { maritalStatus: "D", dependentAllowances: 2, adjustmentAllowances: 0 }).stateCents).to.equal(0);
  });

  it("switches to 4.99% and the higher deductions on May 11", () => {
    const before = at(ga, "2026-05-08", 2_000_00, 26).stateCents;
    const after = at(ga, "2026-05-11", 2_000_00, 26).stateCents;
    expect(before).to.equal(Math.round((200_000 - 46_154) * 0.0519));
    expect(after).to.equal(Math.round((200_000 - 57_692) * 0.0499));
  });
});

describe("Idaho before July 23, 2026 (EPB00744 04-28-2025 + ICTCAT)", () => {
  const early = id.TABLES[2026].earlier[0];

  it("reproduces every printed per-period threshold", () => {
    const th = (annual, n) => id.thresholdCents(annual, n) / 100;
    const t = early.annualThresholdCents;
    expect([1, 12, 24, 26, 52, 260].map((n) => th(t.single, n))).to.deep.equal([15_000, 1_250, 625, 577, 288, 58]);
    expect([1, 12, 24, 26, 52, 260].map((n) => th(t.married, n))).to.deep.equal([30_000, 2_500, 1_250, 1_154, 577, 115]);
  });

  it("Tax Commission example: unmarried, biweekly $1,212, four allowances -> $2", () => {
    // 1,212 - 4 x 148.77 = 616.92; 5.3% of the amount over $577 = 2.12 -> $2
    expect(at(id, "2026-03-13", 1_212_00, 26, { withholdingStatus: "A", allowances: 4 }).stateCents).to.equal(2_00);
  });

  it("allowances stop counting on July 23", () => {
    const form = { withholdingStatus: "A", allowances: 1 };
    expect(at(id, "2026-07-22", 1_000_00, 52, form).stateCents).to.equal(Math.round(((1_000_00 - 74_38 - 288_00) * 0.053) / 100) * 100);
    expect(at(id, "2026-07-23", 1_000_00, 52, form).stateCents).to.equal(37_00);
  });

  it("the allowance table has no quarterly amount, so allowances there throw", () => {
    expect(() => at(id, "2026-03-13", 5_000_00, 4, { withholdingStatus: "A", allowances: 1 })).to.throw(/no amount for 4 pay periods/);
    expect(at(id, "2026-03-13", 5_000_00, 4, { withholdingStatus: "A", allowances: 0 }).stateCents).to.equal(Math.round(((5_000_00 - 3_750_00) * 0.053) / 100) * 100);
  });
});

describe("Utah before June 1, 2026 (Pub 14 Rev. 4/25: all six worked examples)", () => {
  const w4 = (filingStatus) => ({ formYear: 2024, filingStatus });
  const may = (wages, n, status) => at(ut, "2026-05-29", wages, n, null, { federalW4: w4(status) }).stateCents;
  it("Ex. 1: weekly single $400 -> $12", () => expect(may(400_00, 52, "single")).to.equal(12_00));
  it("Ex. 2: biweekly single $2,600 -> $117", () => expect(may(2_600_00, 26, "single")).to.equal(117_00));
  it("Ex. 3: semimonthly married $1,200 -> $22", () => expect(may(1_200_00, 24, "marriedFilingJointly")).to.equal(22_00));
  it("Ex. 4: monthly married $7,800 -> $351", () => expect(may(7_800_00, 12, "marriedFilingJointly")).to.equal(351_00));
  it("Ex. 5: quarterly single $9,000 -> $379", () => expect(may(9_000_00, 4, "single")).to.equal(379_00));
  it("Ex. 6: daily married $175 -> $6", () => expect(may(175_00, 260, "marriedFilingJointly")).to.equal(6_00));
  it("June 1 pay dates use Rev. 4/26", () =>
    expect(at(ut, "2026-06-01", 2_600_00, 26, null, { federalW4: w4("single") }).stateCents).to.equal(116_00));
});

describe("Ohio before August 1, 2026 (Percentage Method effective October 1, 2025)", () => {
  const early = oh.TABLES[2026].earlier[0];

  it("reproduces every printed edge, base and exemption amount", () => {
    const printed = {
      weekly: [12_50, 500_96, 8_89, 1_923_08, 51_41],
      biweekly: [25_00, 1_001_92, 17_78, 3_846_15, 102_82],
      semimonthly: [27_08, 1_085_42, 19_27, 4_166_67, 111_40],
      monthly: [54_17, 2_170_83, 38_53, 8_333_33, 222_79],
      daily: [2_50, 100_19, 1_78, 384_62, 10_28],
    };
    for (const [p, [ex, e1, b1, e2, b2]] of Object.entries(printed)) {
      const { exemptionCents, rows } = oh.periodTable(early, p);
      expect([exemptionCents, rows[1][0], rows[1][1], rows[2][0], rows[2][1]], p).to.deep.equal([ex, e1, b1, e2, b2]);
    }
  });

  it("$1,000 weekly, 1 exemption, paid July 31: $8.89 + 2.99% x ($987.50 - $500.96)", () => {
    expect(at(oh, "2026-07-31", 1_000_00, 52, { exemptions: 1 }).stateCents).to.equal(Math.round(8_89 + (98_750 - 50_096) * 0.0299));
  });

  it("1.775% in the first bracket", () => {
    expect(at(oh, "2026-02-06", 400_00, 52).stateCents).to.equal(Math.round(400_00 * 0.01775));
  });

  it("school district tax is the same before and after", () => {
    const form = { exemptions: 1, schoolDistrict: "2514" };
    const july = at(oh, "2026-07-31", 1_000_00, 52, form).localities;
    const aug = at(oh, "2026-08-07", 1_000_00, 52, form).localities;
    expect(july).to.deep.equal(aug);
  });
});

describe("Indiana: Boone County before October 1, 2026 (0.017)", () => {
  const boone = { personalExemptions: 1, countyOfResidence: "06" };
  const taxable = 1_000_00 - Math.round(1_000_00 / 52);

  it("0.017 through September, 0.0171 from October 1", () => {
    expect(at(ind, "2026-09-25", 1_000_00, 52, boone).localities["IN-06"]).to.equal(Math.round(taxable * 0.017));
    expect(at(ind, "2026-10-02", 1_000_00, 52, boone).localities["IN-06"]).to.equal(Math.round(taxable * 0.0171));
  });

  it("other counties are unaffected by the date", () => {
    const marion = { personalExemptions: 1, countyOfResidence: "49" };
    expect(at(ind, "2026-09-25", 1_000_00, 52, marion).localities).to.deep.equal(at(ind, "2026-10-02", 1_000_00, 52, marion).localities);
  });
});

describe("the pay date picks the figures through computeStateWithholdingCents", () => {
  it("Georgia in March vs. November", () => {
    const run = (payDate) =>
      computeStateWithholdingCents({ state: "GA", taxYear: 2026, grossPayCents: 2_000_00, federalTaxableWagesCents: 2_000_00, payPeriodsPerYear: 26, payDate });
    expect(run("2026-03-13").stateCents).to.equal(Math.round((200_000 - 46_154) * 0.0519));
    expect(run("2026-11-13").stateCents).to.equal(Math.round((200_000 - 57_692) * 0.0499));
  });
});

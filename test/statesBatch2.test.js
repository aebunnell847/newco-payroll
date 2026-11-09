// Plain-English overview: Arizona, Georgia, Idaho, Indiana, Iowa,
// Louisiana, Mississippi and Utah withholding, each checked against its own
// agency's worked examples or printed tables.

const { expect } = require("chai");
const { computeStateWithholdingCents } = require("../src/regulatory/state");
const az = require("../src/regulatory/state/az");
const ga = require("../src/regulatory/state/ga");
const id = require("../src/regulatory/state/id");
const ia = require("../src/regulatory/state/ia");
const ind = require("../src/regulatory/state/in");
const la = require("../src/regulatory/state/la");
const ms = require("../src/regulatory/state/ms");
const ut = require("../src/regulatory/state/ut");

const PAY_DATE = "2026-11-06";
const at = (m, wagesCents, payPeriodsPerYear, form = null, extra = {}) =>
  m.compute({ taxYear: 2026, wagesCents, payPeriodsPerYear, form, payDate: PAY_DATE, ...extra });

describe("Arizona (Form A-4 percentage election)", () => {
  it("no A-4: the 2.0% default", () => {
    const r = at(az, 2_000_00, 26);
    expect(r.stateCents).to.equal(40_00);
    expect(r.formBasis).to.equal("none-on-file-default-2-percent");
  });
  it("elected rate plus the extra amount", () => {
    expect(at(az, 2_000_00, 26, { ratePercent: 3.5, additionalWithholdingCents: 5_00 }).stateCents).to.equal(75_00);
  });
  it("the zero election withholds nothing", () => expect(at(az, 2_000_00, 26, { ratePercent: 0 }).stateCents).to.equal(0));
  it("rejects a rate that isn't on the form", () => expect(() => at(az, 1, 26, { ratePercent: 2.25 })).to.throw(/ratePercent/));
});

describe("Georgia (2026 Employer's Guide percentage method, from May 11, 2026)", () => {
  it("Guide example: head of household, $935 biweekly, two children -> $0.00", () => {
    const r = at(ga, 935_00, 26, { maritalStatus: "D", dependentAllowances: 2, adjustmentAllowances: 0 });
    expect(r.lines.standardDeductionCents).to.equal(576_92);
    expect(r.stateCents).to.equal(0);
  });

  it("reproduces every printed Table F figure", () => {
    const printed = {
      joint: [576_92, 1_153_85, 1_250_00, 2_500_00, 7_500_00, 15_000_00, 30_000_00, 82_19],
      single: [288_46, 576_92, 625_00, 1_250_00, 3_750_00, 7_500_00, 15_000_00, 41_10],
      dependent: [96_15, 192_31, 208_33, 416_67, 1_250_00, 2_500_00, 5_000_00, 13_70],
    };
    const periods = ["weekly", "biweekly", "semimonthly", "monthly", "quarterly", "semiannual", "annual", "daily"];
    const t = ga.TABLES[2026];
    expect(periods.map((p) => ga.perPeriod(t.annualStandardDeductionCents.joint, p))).to.deep.equal(printed.joint);
    expect(periods.map((p) => ga.perPeriod(t.annualStandardDeductionCents.single, p))).to.deep.equal(printed.single);
    expect(periods.map((p) => ga.perPeriod(t.annualAllowanceCents, p))).to.deep.equal(printed.dependent);
  });

  it("4.99% after the deduction; married with one spouse working uses $30,000", () => {
    const r = at(ga, 3_000_00, 26, { maritalStatus: "C", dependentAllowances: 1, adjustmentAllowances: 0 });
    expect(r.stateCents).to.equal(Math.round((300_000 - 115_385 - 19_231) * 0.0499));
  });

  it("no G-4: single, zero allowances", () => {
    expect(at(ga, 2_000_00, 26).stateCents).to.equal(Math.round((200_000 - 57_692) * 0.0499));
  });

  it("needs a pay date (earlier 2026 figures: test/earlier2026.test.js)", () => {
    expect(() => at(ga, 2_000_00, 26, null, { payDate: null })).to.throw(/needs the pay date/);
  });
});

describe("Idaho (EPB00744, revised 07-23-2026)", () => {
  it("reproduces every printed per-period threshold", () => {
    const t = id.TABLES[2026].annualThresholdCents;
    const th = (annual, n) => id.thresholdCents(annual, n) / 100;
    expect([1, 12, 24, 26, 52, 260].map((n) => th(t.single, n))).to.deep.equal([16_100, 1_342, 671, 619, 310, 62]);
    expect([1, 12, 24, 26, 52, 260].map((n) => th(t.married, n))).to.deep.equal([32_200, 2_683, 1_342, 1_238, 619, 124]);
  });

  it("5.3% over the threshold, rounded to the dollar; married uses the married chart, C the single one", () => {
    expect(at(id, 1_000_00, 52, { withholdingStatus: "A" }).stateCents).to.equal(37_00); // (1000-310) x 5.3% = 36.57
    expect(at(id, 1_000_00, 52, { withholdingStatus: "B" }).stateCents).to.equal(20_00); // (1000-619) x 5.3% = 20.19
    expect(at(id, 1_000_00, 52, { withholdingStatus: "C" }).stateCents).to.equal(37_00);
  });

  it("allowances no longer reduce withholding (child tax credit sunset)", () => {
    expect(at(id, 1_000_00, 52, { withholdingStatus: "A", allowances: 3 }).stateCents).to.equal(37_00);
  });

  it("a pay date before 2026 has no 2026 figures", () => {
    expect(() => at(id, 1_000_00, 52, null, { payDate: "2025-12-31" })).to.throw(/Idaho withholding for pay date 2025-12-31 \(these figures apply from 2026-01-01\)/);
  });
});

describe("Iowa (2026 withholding formula: all ten worked examples)", () => {
  const ex = (G, P, form) => at(ia, G, P, { formYear: 2026, ...form }).stateCents;
  it("Ex. 1-3: $2,100 biweekly - other / joint no-earner / head of household", () => {
    expect(ex(2_100_00, 26, { maritalStatus: "other", allowanceCents: 40_00 })).to.equal(59_26);
    expect(ex(2_100_00, 26, { maritalStatus: "marriedJointSpouseNoEarnings", allowanceCents: 80_00 })).to.equal(38_72);
    expect(ex(2_100_00, 26, { maritalStatus: "headOfHousehold", allowanceCents: 160_00 })).to.equal(45_15);
  });
  it("Ex. 4-6: $5,000 monthly", () => {
    expect(ex(5_000_00, 12, { maritalStatus: "other", allowanceCents: 40_00 })).to.equal(145_50);
    expect(ex(5_000_00, 12, { maritalStatus: "marriedJointSpouseNoEarnings", allowanceCents: 80_00 })).to.equal(101_00);
    expect(ex(5_000_00, 12, { maritalStatus: "headOfHousehold", allowanceCents: 160_00 })).to.equal(114_92);
  });
  it("Ex. 7-10: 2023-or-earlier IA W-4 (allowances x $40)", () => {
    const old = (G, P, maritalStatus, allowances) => at(ia, G, P, { formYear: 2023, maritalStatus, allowances }).stateCents;
    expect(old(2_100_00, 26, "single", 1)).to.equal(59_26);
    expect(old(2_100_00, 26, "married", 2)).to.equal(38_72);
    expect(old(5_000_00, 12, "single", 1)).to.equal(145_50);
    expect(old(5_000_00, 12, "married", 2)).to.equal(101_00);
  });
  it("each per-period deduction is the annual figure / periods (daily: / 260)", () => {
    for (const set of Object.values(ia.TABLES[2026].deductionCents)) {
      for (const col of Object.values(set)) {
        const n = { daily: 260, weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12, annual: 1 };
        for (const [p, v] of Object.entries(col)) expect(v, p).to.equal(Math.round(col.annual / n[p]));
      }
    }
  });
  it("no IA W-4: column A, no allowances; quarterly pay annualizes", () => {
    expect(at(ia, 2_100_00, 26).stateCents).to.equal(Math.round(160_000 * 0.038));
    expect(at(ia, 15_000_00, 4).lines.T3).to.equal(Math.round(Math.round((60_000_00 - 13_000_00) * 0.038) / 4));
  });
});

describe("Indiana (Departmental Notice #1, effective Oct. 1, 2026)", () => {
  it("Notice example: $800 weekly, 5/3/1/2 exemptions, 1% county -> $13.96 state, $4.73 county", () => {
    const r = at(ind, 800_00, 52, {
      personalExemptions: 5,
      additionalDependentExemptions: 3,
      firstTimeDependentExemptions: 1,
      adoptedDependentExemptions: 2,
      countyOfResidence: "31", // Harrison, 0.01
    });
    expect(r.lines.taxableCents).to.equal(473_08);
    expect(r.stateCents).to.equal(13_96);
    expect(r.localities).to.deep.equal({ "IN-31": 4_73 });
  });

  it("has all 92 counties (generated from the Notice)", () => {
    expect(Object.keys(ind.TABLES[2026].counties)).to.have.length(92);
    expect(ind.TABLES[2026].counties["49"]).to.include({ name: "Marion", ratePpm: 20_200 });
  });

  it("uses the county of principal employment for an out-of-state resident", () => {
    const r = at(ind, 1_000_00, 52, { personalExemptions: 1, countyOfResidence: null, countyOfPrincipalEmployment: "49" });
    expect(Object.keys(r.localities)).to.deep.equal(["IN-49"]);
  });

  it("Boone changed on Oct. 1, so Boone needs a pay date (earlier rate: test/earlier2026.test.js)", () => {
    const boone = { personalExemptions: 1, countyOfResidence: "06" };
    expect(() => at(ind, 1_000_00, 52, boone, { payDate: null })).to.throw(/Boone County \(Indiana\) withholding needs the pay date/);
    expect(at(ind, 1_000_00, 52, { personalExemptions: 1, countyOfResidence: "49" }, { payDate: null }).stateCents).to.be.greaterThan(0);
  });

  it("no WH-4: state tax with no exemptions and no county tax, flagged", () => {
    const r = at(ind, 1_000_00, 52);
    expect(r.stateCents).to.equal(29_50);
    expect(r.localities).to.deep.equal({});
    expect(r.formBasis).to.equal("none-on-file-no-county");
  });

  it("county tax flows through computeStateWithholdingCents as a locality", () => {
    const r = computeStateWithholdingCents({
      state: "IN",
      taxYear: 2026,
      grossPayCents: 1_000_00,
      federalTaxableWagesCents: 1_000_00,
      payPeriodsPerYear: 52,
      form: { personalExemptions: 0, countyOfResidence: "31" },
      payDate: PAY_DATE,
    });
    expect(r.localCents).to.equal(10_00);
  });
});

describe("Louisiana (R-1306 1/26 computer formula)", () => {
  it("Example 1: claiming 1, $700 weekly -> $13.98", () => expect(at(la, 700_00, 52, { deductions: 1 }).stateCents).to.equal(13_98));
  it("Example 2: claiming 2, $4,600 biweekly -> $111.54", () =>
    expect(at(la, 4_600_00, 26, { deductions: 2 }).stateCents).to.equal(111_54));
  it("no L-4: no standard deduction", () => expect(at(la, 700_00, 52).stateCents).to.equal(Math.round(70_000 * 0.0309)));
  it("line 7 adjustment can lower withholding, never below zero", () => {
    expect(at(la, 700_00, 52, { deductions: 1, adjustmentCents: -3_98 }).stateCents).to.equal(10_00);
    expect(at(la, 700_00, 52, { deductions: 1, adjustmentCents: -50_00 }).stateCents).to.equal(0);
  });
});

describe("Mississippi (Pub 89-700, 2026)", () => {
  it("matches the printed biweekly single table, $1,500-$1,520 row, every exemption column", () => {
    const columns = [0, 6_000, 7_500, 9_000, 10_500, 12_000, 13_500, 15_000, 16_500, 18_000];
    const printed = [41, 32, 30, 28, 25, 23, 21, 18, 16, 14];
    const got = columns.map((x) => at(ms, 1_510_00, 26, { status: "single", exemptionCents: x * 100 }).stateCents / 100);
    expect(got).to.deep.equal(printed);
  });

  it("matches other printed rows ($1,000-$1,020 and $1,880-$1,900)", () => {
    const row = (wages, x) => at(ms, wages, 26, { status: "single", exemptionCents: x }).stateCents / 100;
    expect([row(1_010_00, 0), row(1_010_00, 6_000_00)]).to.deep.equal([21, 12]);
    expect([row(1_890_00, 0), row(1_890_00, 6_000_00)]).to.deep.equal([57, 47]);
  });

  it("no 89-350: zero exemption on the single table", () => {
    expect(at(ms, 1_510_00, 26).stateCents).to.equal(41_00);
  });
});

describe("Utah (Pub 14, Rev. 4/26: all six worked examples)", () => {
  const w4 = (filingStatus) => ({ formYear: 2024, filingStatus });
  it("Ex. 1: weekly single $400 -> $12", () => expect(at(ut, 400_00, 52, null, { federalW4: w4("single") }).stateCents).to.equal(12_00));
  it("Ex. 2: biweekly single $2,600 -> $116", () => expect(at(ut, 2_600_00, 26, null, { federalW4: w4("single") }).stateCents).to.equal(116_00));
  it("Ex. 3: semimonthly married $1,200 -> $18", () =>
    expect(at(ut, 1_200_00, 24, null, { federalW4: w4("marriedFilingJointly") }).stateCents).to.equal(18_00));
  it("Ex. 4: monthly married $7,800 -> $347", () =>
    expect(at(ut, 7_800_00, 12, null, { federalW4: w4("marriedFilingJointly") }).stateCents).to.equal(347_00));
  it("Ex. 5: quarterly single $9,000 -> $367", () => expect(at(ut, 9_000_00, 4, null, { federalW4: w4("single") }).stateCents).to.equal(367_00));
  it("Ex. 6: daily married $175 -> $5", () =>
    expect(at(ut, 175_00, 260, null, { federalW4: w4("marriedFilingJointly") }).stateCents).to.equal(5_00));
  it("head of household and no W-4 use the single schedule", () => {
    expect(at(ut, 400_00, 52, null, { federalW4: w4("headOfHousehold") }).lines.status).to.equal("single");
    expect(at(ut, 400_00, 52).lines.status).to.equal("single");
  });
  it("Utah-only exclusions withhold nothing", () => expect(at(ut, 400_00, 52, { exempt: "militarySpouse" }).stateCents).to.equal(0));
  it("needs a pay date", () => expect(() => at(ut, 400_00, 52, null, { payDate: null })).to.throw(/Utah withholding needs the pay date/));
});

describe("pay date reaches state rules in a stored payroll run", () => {
  it("withholds Georgia tax at 4.99% for a November 2026 pay date", async () => {
    const { openPayrollStore } = require("../src/data/payrollStore");
    const { runStoredPayroll } = require("../src/payroll/storedPayrollRun");
    const store = openPayrollStore();
    try {
      store.upsertEmployee({
        id: "ga-1",
        payType: "salary",
        annualSalaryCents: 52_000_00,
        payPeriodsPerYear: 26,
        workState: "GA",
        stateW4: { maritalStatus: "A", dependentAllowances: 0, adjustmentAllowances: 0 },
      });
      store.createPayPeriod({ id: "2026-P23", periodStart: "2026-10-19", periodEnd: "2026-11-01", payDate: "2026-11-06" });
      await runStoredPayroll(store, "2026-P23");
      // $2,000 biweekly - $576.92 standard deduction = $1,423.08 x 4.99%
      expect(store.getResult("ga-1", "2026-P23").stateWithholdingCents).to.equal(Math.round(142_308 * 0.0499));
    } finally {
      store.close();
    }
  });
});

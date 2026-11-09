// Plain-English overview: New Jersey withholding checked against the
// Division of Taxation's own published tables and the worked examples in
// NJ-WT ("Examples of Percentage Method Calculations", Rate A and Rate B).
//
// About those examples: their wording is unchanged since the 2007 NJ-WT,
// and three of them use bracket edges from before the current tables (paid
// on and after Oct. 1, 2020) - e.g. "$384 / $961 / $5.76" where today's
// tables say $385 / $962 / $5.77. The three that fall in brackets that
// didn't change match to the cent; the other three are within 2 cents of
// the stale figure, and this code follows the current tables.

const { expect } = require("chai");
const nj = require("../src/regulatory/state/nj");
const { computeStateWithholdingCents } = require("../src/regulatory/state");

const weekly = (wagesCents, form) => nj.compute({ wagesCents, payPeriodsPerYear: 52, form }).stateCents;
const rateA1 = { filingStatus: "single", allowances: 1 };
const rateB3 = { filingStatus: "marriedJoint", allowances: 3 };

describe("New Jersey: NJ-WT worked examples (weekly)", () => {
  it("Rate A, Example 1: $300, 1 allowance -> $4.21", () => expect(weekly(300_00, rateA1)).to.equal(4_21));
  it("Rate A, Example 2: $700, 1 allowance -> $11.84", () => expect(weekly(700_00, rateA1)).to.equal(11_84));
  it("Rate B, Example 1: $375, 3 allowances -> $4.76", () => expect(weekly(375_00, rateB3)).to.equal(4_76));

  it("Rate A Ex. 3 and Rate B Ex. 2-3: within 2 cents of the pre-2020 figures the booklet still prints", () => {
    expect(Math.abs(weekly(1_200_00, rateA1) - 40_40)).to.be.at.most(2);
    expect(Math.abs(weekly(950_00, rateB3) - 15_93)).to.be.at.most(2);
    expect(Math.abs(weekly(1_400_00, rateB3) - 27_60)).to.be.at.most(2);
  });

  it("follows the current table exactly: $1,342.40 taxable on Rate B = $17.31 + 2.7% x $380.40", () => {
    expect(weekly(1_400_00, rateB3)).to.equal(Math.round(1_731 + (134_240 - 96_200) * 0.027));
  });
});

describe("New Jersey: the published tables", () => {
  const { rates, allowanceCents } = nj.TABLES.shared;

  it("has all five rate tables for all eight payroll periods", () => {
    expect(Object.keys(rates)).to.deep.equal(["A", "B", "C", "D", "E"]);
    for (const r of Object.values(rates)) {
      expect(Object.keys(r).sort()).to.deep.equal(
        ["annual", "biweekly", "daily", "monthly", "quarterly", "semiannual", "semimonthly", "weekly"]
      );
    }
  });

  it("pins the allowance values from NJ-WT's Withholding Allowance Value Table", () => {
    expect(allowanceCents).to.deep.equal({
      weekly: 19_20,
      biweekly: 38_40,
      semimonthly: 41_60,
      monthly: 83_30,
      quarterly: 250_00,
      semiannual: 500_00,
      annual: 1_000_00,
      daily: 2_70,
    });
  });

  it("each bracket's base follows from the one before (within the Division's rounding)", () => {
    for (const [letter, byPeriod] of Object.entries(rates)) {
      for (const [period, rows] of Object.entries(byPeriod)) {
        expect(rows[0].slice(0, 2), `${letter} ${period}`).to.deep.equal([0, 0]);
        for (let i = 1; i < rows.length; i++) {
          const [o0, b0, r0] = rows[i - 1];
          const [o1, b1] = rows[i];
          expect(Math.abs(b0 + ((o1 - o0) * r0) / 10_000 - b1), `${letter} ${period} row ${i}`).to.be.at.most(100);
        }
      }
    }
  });

  it("carries the corrected Rate D quarterly bracket ($15,000, printed as \"$15.000\")", () => {
    expect(rates.D.quarterly.some(([over]) => over === 15_000_00)).to.equal(true);
  });

  it("tops out at 11.8% in every table", () => {
    for (const byPeriod of Object.values(rates)) {
      for (const rows of Object.values(byPeriod)) expect(rows[rows.length - 1][2]).to.equal(1180);
    }
  });
});

describe("New Jersey: rules", () => {
  it("picks Rate A for single / married-separate and Rate B for joint, head of household, widow(er)", () => {
    const r = (filingStatus) =>
      nj.compute({ wagesCents: 2_000_00, payPeriodsPerYear: 26, form: { filingStatus, allowances: 0 } }).lines.rateTable;
    expect(["single", "marriedSeparate"].map(r)).to.deep.equal(["A", "A"]);
    expect(["marriedJoint", "headOfHousehold", "qualifyingWidow"].map(r)).to.deep.equal(["B", "B", "B"]);
  });

  it("uses the table the employee chose on line 3", () => {
    const form = { filingStatus: "marriedJoint", rateTable: "E", allowances: 0 };
    expect(nj.compute({ wagesCents: 2_000_00, payPeriodsPerYear: 26, form }).lines.rateTable).to.equal("E");
  });

  it("withholds at Rate A with zero allowances when no NJ-W4 is on file", () => {
    const none = nj.compute({ wagesCents: 2_000_00, payPeriodsPerYear: 26, form: null });
    const a0 = nj.compute({ wagesCents: 2_000_00, payPeriodsPerYear: 26, form: { filingStatus: "single", allowances: 0 } });
    expect(none.stateCents).to.equal(a0.stateCents);
    expect(none.formBasis).to.equal("none-on-file-rate-a-zero");
  });

  it("honors exempt and line 5 additional withholding", () => {
    const base = { filingStatus: "single", allowances: 1 };
    expect(weekly(1_000_00, { ...base, exempt: true })).to.equal(0);
    expect(weekly(1_000_00, { ...base, additionalWithholdingCents: 10_00 })).to.equal(weekly(1_000_00, base) + 10_00);
  });

  it("supports quarterly and semiannual pay, unlike New York's tables", () => {
    const q = nj.compute({ wagesCents: 15_000_00, payPeriodsPerYear: 4, form: rateA1 });
    expect(q.stateCents).to.be.greaterThan(0);
    expect(() => nj.compute({ wagesCents: 1, payPeriodsPerYear: 13, form: rateA1 })).to.throw(/no rate table for 13/);
  });

  it("withholds on federal income-tax wages (401(k) within the federal limit excluded, per NJ-WT)", () => {
    const r = computeStateWithholdingCents({
      state: "NJ",
      taxYear: 2026,
      grossPayCents: 4_000_00,
      federalTaxableWagesCents: 3_800_00,
      payPeriodsPerYear: 26,
      form: { filingStatus: "single", allowances: 1 },
    });
    expect(r.wagesCents).to.equal(3_800_00);
    expect(r.state).to.equal("NJ");
  });

  it("validates the NJ-W4", () => {
    expect(() => weekly(1, { filingStatus: "married" })).to.throw(/NJ-W4: filingStatus/);
    expect(() => weekly(1, { filingStatus: "single", rateTable: "F" })).to.throw(/rateTable/);
    expect(() => weekly(1, { filingStatus: "single", allowances: 1.5 })).to.throw(/allowances/);
  });
});

describe("New Jersey in a payroll run", () => {
  it("withholds NJ tax from the employee's NJ-W4 in a stored run", async () => {
    const { openPayrollStore } = require("../src/data/payrollStore");
    const { runStoredPayroll } = require("../src/payroll/storedPayrollRun");
    const store = openPayrollStore();
    try {
      store.upsertEmployee({
        id: "nj-1",
        payType: "salary",
        annualSalaryCents: 104_000_00,
        payPeriodsPerYear: 26,
        workState: "NJ",
        stateW4: { filingStatus: "marriedJoint", allowances: 2 },
      });
      store.createPayPeriod({ id: "2026-P01", periodStart: "2025-12-22", periodEnd: "2026-01-04", payDate: "2026-01-09" });
      await runStoredPayroll(store, "2026-P01");
      const r = store.getResult("nj-1", "2026-P01");
      // Rate B biweekly: $4,000 - 2 x $38.40 = $3,923.20 taxable -> $70.00 + 6.1% x ($3,923.20 - $3,077)
      expect(r.stateWithholdingCents).to.equal(Math.round(70_00 + (392_320 - 307_700) * 0.061));
    } finally {
      store.close();
    }
  });
});

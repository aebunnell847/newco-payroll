// Plain-English overview: proves the federal withholding module matches IRS
// Publication 15-T three independent ways:
//   1. Internal consistency: in every schedule, each bracket's base amount
//      (column C) equals the previous base plus the previous rate times the
//      bracket width, within the IRS's own rounding of bracket edges. A
//      corrupted or mistyped number breaks this chain.
//   2. Spot values pinned to the published tables.
//   3. Results compared to the IRS's separate Wage Bracket Method table
//      (2026, weekly), which is computed by the IRS, not by this code.
// Plus the Worksheet 1A rules: Step 2 checkbox, Steps 3/4, old W-4s,
// exempt, and no W-4 on file.

const { expect } = require("chai");
const {
  PERCENTAGE_METHOD_TABLES,
  WORKSHEET_1A,
  computeFederalWithholdingCents,
  validateW4,
} = require("../src/regulatory/federalWithholding");

const single2026 = { formYear: 2026, filingStatus: "single" };
const run = (overrides) =>
  computeFederalWithholdingCents({
    taxYear: 2026,
    taxableWagesCents: 100_000,
    payPeriodsPerYear: 52,
    w4: single2026,
    ...overrides,
  });

describe("Pub 15-T percentage method tables", () => {
  for (const [year, statuses] of Object.entries(PERCENTAGE_METHOD_TABLES)) {
    for (const [status, schedules] of Object.entries(statuses)) {
      for (const [kind, rows] of Object.entries(schedules)) {
        it(`${year} ${status} ${kind}: each bracket's base follows from the one before`, () => {
          expect(rows).to.have.length(8);
          expect(rows[0]).to.deep.equal([0, 0, 0]);
          expect(rows.map((r) => r[2])).to.deep.equal([0, 1000, 1200, 2200, 2400, 3200, 3500, 3700]);
          for (let i = 1; i < rows.length; i++) {
            const [prevOver, prevBase, prevRate] = rows[i - 1];
            const [over, base] = rows[i];
            expect(over).to.be.greaterThan(prevOver);
            const implied = prevBase + ((over - prevOver) * prevRate) / 10_000;
            // The IRS rounds checkbox-schedule edges to whole dollars, so the
            // chain drifts by cents; a typo would be off by dollars.
            expect(Math.abs(implied - base), `row ${i}`).to.be.at.most(100);
          }
        });
      }
    }
  }

  it("pins spot values from the 2026 and 2025 tables", () => {
    expect(PERCENTAGE_METHOD_TABLES[2026].single.standard[2]).to.deep.equal([19_900_00, 1_240_00, 1200]);
    expect(PERCENTAGE_METHOD_TABLES[2026].marriedFilingJointly.standard[7]).to.deep.equal([788_000_00, 206_583_50, 3700]);
    expect(PERCENTAGE_METHOD_TABLES[2026].single.step2Checkbox[7]).to.deep.equal([328_350_00, 96_489_63, 3700]);
    expect(PERCENTAGE_METHOD_TABLES[2026].headOfHousehold.standard[1]).to.deep.equal([15_550_00, 0, 1000]);
    expect(PERCENTAGE_METHOD_TABLES[2025].single.standard[1]).to.deep.equal([6_400_00, 0, 1000]);
    expect(PERCENTAGE_METHOD_TABLES[2025].marriedFilingJointly.step2Checkbox[7]).to.deep.equal([390_800_00, 101_077_25, 3700]);
  });

  it("pins Worksheet 1A's line 1g and allowance amounts", () => {
    for (const y of [2025, 2026]) {
      expect(WORKSHEET_1A[y].line1gMarriedFilingJointlyCents).to.equal(12_900_00);
      expect(WORKSHEET_1A[y].line1gOtherCents).to.equal(8_600_00);
      expect(WORKSHEET_1A[y].allowanceCents).to.equal(4_300_00);
      expect(WORKSHEET_1A[y].sources[0]).to.match(/https:\/\/www\.irs\.gov\//);
    }
  });

  it("is frozen", () => {
    expect(Object.isFrozen(PERCENTAGE_METHOD_TABLES[2026].single.standard[3])).to.equal(true);
  });
});

describe("matches the IRS's own 2026 weekly Wage Bracket Method table", () => {
  // From Pub 15-T (2026), Wage Bracket Method Tables for Manual Payroll
  // Systems with Forms W-4 From 2020 or Later, WEEKLY. The table is computed
  // at each bracket's midpoint and rounded to whole dollars.
  // [midpoint wage, MFJ std, MFJ checkbox, HoH std, HoH checkbox, Single std, Single checkbox]
  const IRS_WEEKLY = [
    [710, 9, 43, 25, 54, 43, 71],
    [1000, 38, 78, 57, 101, 78, 135],
    [1500, 96, 160, 117, 216, 160, 252],
  ];
  const columns = [
    ["marriedFilingJointly", false],
    ["marriedFilingJointly", true],
    ["headOfHousehold", false],
    ["headOfHousehold", true],
    ["single", false],
    ["single", true],
  ];
  for (const [wage, ...expected] of IRS_WEEKLY) {
    it(`$${wage}/week, every filing status and checkbox`, () => {
      columns.forEach(([filingStatus, step2Checkbox], i) => {
        const { federalCents } = run({
          taxableWagesCents: wage * 100,
          w4: { formYear: 2026, filingStatus, step2Checkbox },
        });
        expect(Math.round(federalCents / 100), `${filingStatus} checkbox=${step2Checkbox}`).to.equal(expected[i]);
      });
    });
  }
});

describe("Worksheet 1A", () => {
  it("annualizes, subtracts line 1g, applies the bracket, and divides back", () => {
    const r = run({});
    // $52,000 - $8,600 = $43,400 -> $1,240 + 12% x $23,500 = $4,060 / 52
    expect(r.adjustedAnnualWageCents).to.equal(43_400_00);
    expect(r.lines.line2g).to.equal(4_060_00);
    expect(r.federalCents).to.equal(7_808);
  });

  it("drops line 1g and uses the checkbox schedule when Step 2 is checked", () => {
    const r = run({ w4: { ...single2026, step2Checkbox: true } });
    expect(r.lines.line1g).to.equal(0);
    // $52,000 -> $2,900 + 22% x $18,750 = $7,025 / 52
    expect(r.federalCents).to.equal(13_510);
  });

  it("applies Step 4(a) other income, 4(b) deductions, Step 3 credits and 4(c) extra", () => {
    const r = run({
      w4: {
        ...single2026,
        step4aOtherIncomeCents: 10_000_00,
        step4bDeductionsCents: 5_000_00,
        step3CreditsCents: 2_000_00,
        step4cExtraWithholdingCents: 25_00,
      },
    });
    // $52,000 + $10,000 - $5,000 - $8,600 = $48,400 -> $1,240 + 12% x $28,500 = $4,660
    // $4,660/52 - $2,000/52 = $51.15; + $25
    expect(r.adjustedAnnualWageCents).to.equal(48_400_00);
    expect(r.federalCents).to.equal(Math.round((4_660_00 - 2_000_00) / 52 + 25_00));
  });

  it("never withholds less than the Step 4(c) extra, even when credits exceed the tax", () => {
    const r = run({ w4: { ...single2026, step3CreditsCents: 50_000_00, step4cExtraWithholdingCents: 10_00 } });
    expect(r.lines.line3c).to.equal(0);
    expect(r.federalCents).to.equal(10_00);
  });

  it("handles 2019-or-earlier W-4s with allowances", () => {
    const r = run({ w4: { formYear: 2019, maritalStatus: "single", allowances: 2 } });
    // $52,000 - 2 x $4,300 = $43,400 -> same as above with no line 1g
    expect(r.lines.line1k).to.equal(8_600_00);
    expect(r.federalCents).to.equal(7_808);
    expect(r.w4Basis).to.equal("form-2019-or-earlier");
    const married = run({ w4: { formYear: 2019, maritalStatus: "married", allowances: 0 } });
    // $52,000 MFJ standard: $2,480 + 12% x $7,900 = $3,428 / 52
    expect(married.federalCents).to.equal(Math.round(3_428_00 / 52));
  });

  it("withholds nothing for an employee who claimed exempt", () => {
    const r = run({ w4: { ...single2026, exempt: true } });
    expect(r.federalCents).to.equal(0);
    expect(r.w4Basis).to.equal("exempt");
  });

  it("uses Single with no adjustments when no W-4 is on file (IRS Pub 15)", () => {
    const r = run({ w4: null });
    expect(r.w4Basis).to.equal("none-on-file");
    expect(r.federalCents).to.equal(7_808);
  });

  it("withholds nothing below the first bracket", () => {
    expect(run({ taxableWagesCents: 300_00 }).federalCents).to.equal(0); // $15,600/yr - $8,600 < $7,500
  });

  it("uses the 2025 tables for a 2025 pay date", () => {
    const r = run({ taxYear: 2025 });
    // $43,400 -> 2025 single: $1,192.50 + 12% x ($43,400 - $18,325) = $4,201.50 / 52
    expect(r.federalCents).to.equal(Math.round(4_201_50 / 52));
  });

  it("refuses a year with no sourced tables, rather than reusing another year's", () => {
    expect(() => run({ taxYear: 2027 })).to.throw(/no sourced IRS withholding tables for tax year 2027/);
  });

  it("validates W-4 input", () => {
    expect(() => validateW4({ formYear: 2026, filingStatus: "married" })).to.throw(/filingStatus/);
    expect(() => validateW4({ formYear: 2018, maritalStatus: "single", allowances: -1 })).to.throw(/allowances/);
    expect(() => validateW4({ formYear: 2026, filingStatus: "single", step3CreditsCents: 10.5 })).to.throw(/cents/);
    expect(() => validateW4(null)).to.not.throw();
  });
});

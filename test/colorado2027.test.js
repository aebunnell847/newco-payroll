// Plain-English overview: Colorado's 2027 withholding, which moves from one
// flat 4.40% rate to six graduated brackets (DR 1098, 11/17/26), plus the
// 2027 DR 0004's new tax credit allowance line. DR 1098 prints no worked
// example, so the expected figures come from the Department's own DR 1098
// Withholding Calculator (.xlsx, Nov. 2026 revision for 2027):
// tools/state/generate_co.py evaluates the calculator's cell formulas
// (J6-J21) in exact fractions for each input below and prints the
// results; they are copied here unchanged.

const { expect } = require("chai");
const { computeStateWithholdingCents, validateStateForm } = require("../src/regulatory/state");
const co = require("../src/regulatory/state/co");

const at = (wagesCents, payPeriodsPerYear, form = null, extra = {}) =>
  co.compute({ taxYear: 2027, wagesCents, payPeriodsPerYear, form, ...extra });

// [wagesCents, periods, line 1d, line 3a, line 3d, -> line 1e, line 2 (cents, unrounded), line 3e (cents)]
// from `python generate_co.py DR_1098_2027.pdf DR_1098_Withholding_Calculator_Nov_2026_Revision_for_2027.xlsx`.
const CALCULATOR_VECTORS = [
  [200000, 26, 550000, 0, 0, 4650000, 182800, 7031],
  [200000, 26, 1100000, 0, 0, 4100000, 159700, 6142],
  [200000, 26, 850000, 0, 0, 4350000, 170200, 6546],
  [50000, 52, 550000, 0, 0, 2050000, 75850, 1459],
  [10000, 52, 550000, 0, 0, 0, 0, 0],
  [250000, 12, 550000, 0, 0, 2450000, 90650, 7554],
  [254200, 12, 550000, 0, 0, 2500400, 92516.8, 7710],
  [3050050, 1, 550000, 0, 0, 2500050, 92501.85, 92502],
  [1000000, 24, 1100000, 120000, 2500, 22900000, 975100, 38129],
  [2500000, 24, 550000, 0, 0, 59450000, 2866800, 119450],
  [7000000, 12, 850000, 0, 0, 83150000, 4661350, 388446],
  [6000000, 26, 0, 0, 0, 156000000, 10696500, 411404],
  [40000, 260, 550000, 0, 0, 9850000, 401200, 1543],
  [3000000, 4, 1100000, 0, 1000, 10900000, 447100, 112775],
  [6000000, 2, 550000, 0, 0, 11450000, 471300, 235650],
  [30000000, 1, 550000, 200000, 0, 29450000, 1263300, 1063300],
  [150000, 26, 1450000, 180000, 0, 2450000, 90650, 0],
];

describe("Colorado 2027 (DR 1098 11/17/26 graduated brackets)", () => {
  describe("generated Withholding Table", () => {
    const rows = co.TABLES[2027].rows;

    it("has six brackets, 3.7% to 8.4%", () => {
      expect(rows.map((r) => r[3])).to.deep.equal([370, 420, 440, 740, 790, 840]);
    });

    it("each Column D follows from the row below (edges at $25,000, $100,000, ...)", () => {
      for (let i = 1; i < rows.length; i++) {
        const [atLeast, subtract, base] = rows[i];
        const [, prevSubtract, prevBase, prevRate] = rows[i - 1];
        expect(atLeast).to.equal(subtract + 100); // Column B = previous Column C + $1
        expect(base).to.equal(prevBase + ((subtract - prevSubtract) * prevRate) / 10_000);
      }
    });

    it("prints $925 / $4,075 / $21,675 / $40,175 / $59,925 in Column D", () => {
      expect(rows.map((r) => r[2])).to.deep.equal([0, 92500, 407500, 2167500, 4017500, 5992500]);
    });
  });

  describe("matches the Department's DR 1098 Withholding Calculator", () => {
    for (const [wages, n, line1d, line3a, line3d, line1e, line2, line3e] of CALCULATOR_VECTORS) {
      it(`$${wages / 100} x ${n}, 1d $${line1d / 100}, 3a $${line3a / 100}, 3d $${line3d / 100} -> $${line3e / 100}`, () => {
        const form = { line2AllowanceCents: line1d, taxCreditAllowanceCents: line3a, additionalWithholdingCents: line3d };
        const r = at(wages, n, form);
        expect(r.lines.line1eCents).to.equal(line1e);
        expect(r.lines.line2Cents).to.be.closeTo(line2, 1e-6);
        expect(r.stateCents).to.equal(line3e);
      });
    }

    it("1e of $25,000.50 stays in bracket 1, as the calculator's row test (1e < $25,001) has it", () => {
      const r = at(3_050_050, 1, { line2AllowanceCents: 5_500_00 });
      expect(r.lines.line2Cents).to.be.closeTo(2_500_050 * 0.037, 1e-6);
    });

    it("subtracts the previous row's Column C, not Column B (line 2b text; flagged)", () => {
      // $25,004 of 1e: $925 + $4 x 4.2% = $925.168 (Column B would give $925.126)
      expect(at(254_200, 12).lines.line2Cents).to.be.closeTo(92_516.8, 1e-6);
    });
  });

  describe("line 1d allowance", () => {
    const w4 = (filingStatus, formYear = 2024, more = {}) => ({ federalW4: { formYear, filingStatus, ...more } });

    it("no certificate: as a single W-4 ($5,500)", () => {
      const r = at(2_000_00, 26);
      expect(r.formBasis).to.equal("none-on-file-single");
      expect(r.lines.line1dCents).to.equal(5_500_00);
      expect(r.stateCents).to.equal(70_31);
    });

    it("W-4 only: $11,000 joint, $5,500 single, $8,500 head of household (new)", () => {
      expect(at(2_000_00, 26, null, w4("marriedFilingJointly")).lines.line1dCents).to.equal(11_000_00);
      expect(at(2_000_00, 26, null, w4("single")).lines.line1dCents).to.equal(5_500_00);
      const hoh = at(2_000_00, 26, null, w4("headOfHousehold"));
      expect(hoh.lines.line1dCents).to.equal(8_500_00);
      expect(hoh.stateCents).to.equal(65_46);
    });

    it("a pre-2020 W-4 (no Step 1(c)) uses the single amount (flagged)", () => {
      expect(at(2_000_00, 26, null, w4("headOfHousehold", 2019)).lines.line1dCents).to.equal(5_500_00);
    });

    it("W-4 claiming exempt with no DR 0004: zero", () => {
      const r = at(2_000_00, 26, null, w4("single", 2024, { exempt: true }));
      expect(r.stateCents).to.equal(0);
      expect(r.formBasis).to.equal("federal-w4-exempt");
    });

    it("DR 0004 line 2 wins, including zero", () => {
      const r = at(2_000_00, 26, { line2AllowanceCents: 0 }, w4("marriedFilingJointly"));
      expect(r.formBasis).to.equal("dr-0004");
      expect(r.lines.line1dCents).to.equal(0);
    });

    it("DR 0004 with line 2 blank (only line 3) falls back to the W-4 amount", () => {
      const r = at(2_000_00, 26, { taxCreditAllowanceCents: 600_00 }, w4("headOfHousehold"));
      expect(r.formBasis).to.equal("dr-0004-line-2-blank-federal-w4");
      expect(r.lines.line1dCents).to.equal(8_500_00);
      expect(r.lines.line3aCents).to.equal(600_00);
    });
  });

  describe("2027 DR 0004 fields", () => {
    it("line 3 tax credit allowance is annual and floors line 3b at zero", () => {
      const r = at(1_500_00, 26, { line2AllowanceCents: 14_500_00, taxCreditAllowanceCents: 1_800_00, additionalWithholdingCents: 5_00 });
      expect(r.lines.line3bCents).to.equal(0);
      expect(r.stateCents).to.equal(5_00); // line 4 extra still applies
    });

    it("rejects a negative or fractional tax credit allowance", () => {
      expect(() => validateStateForm("CO", { taxCreditAllowanceCents: -1 })).to.throw(/Colorado DR 0004: taxCreditAllowanceCents/);
      expect(() => validateStateForm("CO", { taxCreditAllowanceCents: 1.5 })).to.throw(/taxCreditAllowanceCents/);
    });

    it("2026 still takes 2026-style inputs unchanged, and refuses a 2027 tax credit allowance", () => {
      const r2026 = (form) => co.compute({ taxYear: 2026, wagesCents: 2_000_00, payPeriodsPerYear: 26, form });
      expect(r2026({ line2AllowanceCents: 0, additionalWithholdingCents: 10_00 }).stateCents).to.equal(Math.round((52_000_00 * 0.044) / 26) + 10_00);
      expect(r2026({ line2AllowanceCents: 0, taxCreditAllowanceCents: 0 }).stateCents).to.equal(Math.round((52_000_00 * 0.044) / 26));
      expect(() => r2026({ taxCreditAllowanceCents: 100_00 })).to.throw(/2026 DR 1098 worksheet has no tax credit allowance/);
    });

    it("2026 figures are untouched (flat 4.40%, $11,000 / $5,500)", () => {
      expect(co.TABLES[2026].rateBp).to.equal(440);
      expect(co.TABLES[2026].jointAllowanceCents).to.equal(11_000_00);
      expect(co.TABLES[2026].otherAllowanceCents).to.equal(5_500_00);
      // 2026 had no head-of-household amount: still $5,500.
      const r = co.compute({ taxYear: 2026, wagesCents: 2_000_00, payPeriodsPerYear: 26, form: null, federalW4: { formYear: 2024, filingStatus: "headOfHousehold" } });
      expect(r.lines.line2aCents).to.equal(5_500_00);
      expect(r.stateCents).to.equal(78_69);
    });
  });

  describe("through computeStateWithholdingCents", () => {
    it("runs for 2027, with the Denver OPT unchanged", () => {
      const r = computeStateWithholdingCents({
        state: "CO",
        taxYear: 2027,
        grossPayCents: 2_000_00,
        federalTaxableWagesCents: 2_000_00,
        payPeriodsPerYear: 26,
        form: { denverWorker: true },
        monthToDate: { grossCents: 0, localities: {} },
      });
      expect(r.stateCents).to.equal(70_31);
      expect(r.localities).to.deep.equal({ DENVER_OPT: 5_75 });
    });

    it("has no 2028 figures", () => {
      expect(() =>
        computeStateWithholdingCents({ state: "CO", taxYear: 2028, grossPayCents: 1, federalTaxableWagesCents: 1, payPeriodsPerYear: 26 })
      ).to.throw(/no sourced Colorado withholding for tax year 2028/);
    });
  });
});

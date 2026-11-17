// Plain-English overview: 2027 state withholding, each state checked
// against its own 2027 publication's worked examples and printed tables,
// plus checks that the earlier years' figures did not move.

const { expect } = require("chai");
const { computeStateWithholdingCents } = require("../src/regulatory/state");
const sc = require("../src/regulatory/state/sc");

const at = (m, taxYear, wagesCents, payPeriodsPerYear, form = null) =>
  m.compute({ taxYear, wagesCents, payPeriodsPerYear, form, payDate: `${taxYear}-03-05` });

describe("2027: South Carolina (WH-1603F Rev. 10/28/26)", () => {
  it("formula example: $1,000 weekly, 3 allowances -> $41,500 taxable, $1,550.35 a year, $29.81 a week", () => {
    const r = at(sc, 2027, 1_000_00, 52, { allowances: 3 });
    // 52,000 - 6,750 (3 x 2,250) - 3,750 SCIAD (lesser of 3,750 or 10% x 52,000)
    expect(r.lines.standardDeductionCents).to.equal(3_750_00);
    expect(r.lines.taxableAnnualCents).to.equal(41_500_00);
    expect(r.lines.annualTaxCents).to.equal(1_550_35);
    expect(r.stateCents).to.equal(29_81);
  });

  it("SCIAD: $0 with zero allowances, else 10% of annual wages up to $3,750", () => {
    const none = at(sc, 2027, 1_000_00, 52, { allowances: 0 });
    expect(none.lines.standardDeductionCents).to.equal(0);
    expect(none.lines.taxableAnnualCents).to.equal(52_000_00);
    expect(at(sc, 2027, 500_00, 52, { allowances: 1 }).lines.standardDeductionCents).to.equal(2_600_00);
    expect(at(sc, 2027, 5_000_00, 52, { allowances: 1 }).lines.standardDeductionCents).to.equal(3_750_00);
  });

  it("subtraction and addition methods agree: 1.99% under $19,000; 5.21% minus $611.80 from $19,000", () => {
    const { annualTable } = sc.TABLES[2027];
    // The addition method's $378.10 is the first bracket's tax at its top.
    expect(annualTable[1][1] * 10_000).to.equal(annualTable[1][0] * annualTable[0][2]);
    for (const annualCents of [19_000_00, 25_000_00, 41_500_00, 100_000_00, 1_000_000_00]) {
      const r = at(sc, 2027, annualCents, 1, { allowances: 0 });
      expect(r.lines.annualTaxCents).to.be.closeTo((annualCents * 521) / 10_000 - 611_80, 1e-6);
    }
    expect(at(sc, 2027, 18_999_00, 1, { allowances: 0 }).lines.annualTaxCents).to.be.closeTo(378_08, 0.5);
  });

  // Printed WH-1603 (Rev. 10/26/26) rows, 0-10 allowances: the tables are
  // the formula at the bracket midpoint, rounded up to the next dollar
  // (tools/state/generate_sc.py re-derives all 4,873 cells this way).
  const printed = [
    ["daily (footer prints '521%' for 5.21%)", 260, 188, 192, [8, 7, 6, 6, 5, 5, 5, 4, 4, 3, 3]],
    ["weekly", 52, 420, 440, [11, 7, 6, 6, 5, 4, 3, 2, 1, 0, 0]],
    ["bi-weekly", 26, 940, 980, [27, 17, 14, 13, 11, 9, 7, 6, 4, 2, 0]],
    ["semi-monthly", 24, 570, 590, [12, 9, 7, 5, 3, 2, 0, 0, 0, 0, 0]],
    ["monthly", 12, 1_420, 1_460, [29, 23, 19, 15, 11, 8, 4, 0, 0, 0, 0]],
  ];
  for (const [name, periods, lo, hi, dollars] of printed) {
    it(`reproduces the ${name} table row $${lo}-$${hi}`, () => {
      const mid = ((lo + hi) * 100) / 2;
      const got = dollars.map((_, k) =>
        Math.ceil(at(sc, 2027, mid, periods, { allowances: k }).lines.annualTaxCents / periods / 100)
      );
      expect(got).to.deep.equal(dollars);
    });
  }

  it("no SC W-4: zero allowances (2026 WH-1603 wording; not restated for 2027)", () => {
    const r = at(sc, 2027, 1_000_00, 52);
    expect(r.formBasis).to.equal("none-on-file-zero-allowances");
    expect(r.stateCents).to.equal(at(sc, 2027, 1_000_00, 52, { allowances: 0 }).stateCents);
  });

  it("cites the 2027 WH-1603F, WH-1603 and SC W-4", () => {
    const s = sc.TABLES[2027].sources.join("\n");
    expect(s).to.include("WH1603F_2027.pdf").and.include("Rev. 10/28/26");
    expect(s).to.include("WH1603_2027.pdf").and.include("Rev. 10/26/26");
    expect(s).to.include("SCW4_2027.pdf").and.include("Rev. 11/3/26");
  });

  it("2026 and 2025 figures are unchanged", () => {
    expect(sc.years).to.deep.equal([2025, 2026, 2027]);
    const { sources: _s26, ...t26 } = sc.TABLES[2026];
    expect(t26).to.deep.equal({
      allowanceCents: 5_000_00,
      standardDeductionRateBp: 1_000,
      standardDeductionCapCents: 7_500_00,
      annualTable: [[0, 0, 0], [3_640_00, 0, 300], [18_230_00, 437_70, 600]],
    });
    const { sources: _s25, ...t25 } = sc.TABLES[2025];
    expect(t25).to.deep.equal({
      allowanceCents: 4_860_00,
      standardDeductionRateBp: 1_000,
      standardDeductionCapCents: 7_300_00,
      annualTable: [[0, 0, 0], [3_560_00, 0, 300], [17_830_00, 428_10, 620]],
    });
    // Each year's own WH-1603F example still holds.
    expect(at(sc, 2026, 750_00, 52, { allowances: 3 }).stateCents).to.equal(10_58);
    expect(at(sc, 2025, 750_00, 52, { allowances: 3 }).stateCents).to.equal(11_44);
    // The same paycheck under 2026 rules is not the 2027 result.
    expect(at(sc, 2026, 1_000_00, 52, { allowances: 3 }).stateCents).to.not.equal(29_81);
  });

  it("dispatches 2027 through the state index and refuses 2028", () => {
    const args = { state: "SC", grossPayCents: 1_000_00, federalTaxableWagesCents: 1_000_00, payPeriodsPerYear: 52, form: { allowances: 3 } };
    expect(computeStateWithholdingCents({ ...args, taxYear: 2027 }).stateCents).to.equal(29_81);
    expect(() => computeStateWithholdingCents({ ...args, taxYear: 2028 })).to.throw(/no sourced South Carolina withholding for tax year 2028/);
  });
});

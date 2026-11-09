// Plain-English overview: Minnesota, Oregon, Rhode Island, Vermont and West
// Virginia withholding, checked against each agency's worked examples or
// printed tables.

const { expect } = require("chai");
const mn = require("../src/regulatory/state/mn");
const or = require("../src/regulatory/state/or");
const ri = require("../src/regulatory/state/ri");
const vt = require("../src/regulatory/state/vt");
const wv = require("../src/regulatory/state/wv");

const at = (m, wagesCents, payPeriodsPerYear, form = null, extra = {}) =>
  m.compute({ taxYear: 2026, wagesCents, payPeriodsPerYear, form, payDate: "2026-11-06", ...extra });

const basesChain = (rows, tolCents = 1) => {
  for (let i = 2; i < rows.length; i++) {
    const [o0, b0, r0] = rows[i - 1];
    expect(Math.abs(b0 + ((rows[i][0] - o0) * r0) / 10_000 - rows[i][1])).to.be.at.most(tolCents);
  }
};

describe("Minnesota (2026 booklet computer formula)", () => {
  it("each chart row's 'Add' follows from the row below", () => {
    basesChain(mn.TABLES[2026].charts.single);
    basesChain(mn.TABLES[2026].charts.married);
  });
  it("$1,500 weekly, single, 1 allowance: ($78,000 - $5,300 - $38,010) x 6.8% + $1,782.09, / 52", () => {
    const expected = Math.round((1_782_09 + (72_700_00 - 38_010_00) * 0.068) / 52);
    expect(at(mn, 1_500_00, 52, { filingStatus: "single", allowances: 1 }).stateCents).to.equal(expected);
  });
  it("daily payroll annualizes by 360; no W-4MN: single, zero", () => {
    expect(at(mn, 300_00, 260).lines.P).to.equal(360);
    expect(at(mn, 300_00, 260).formBasis).to.equal("none-on-file-single-zero");
  });
});

describe("Oregon (150-206-436, 2026)", () => {
  it("Example 1 (worked lines): $25,000 single, $1,000 federal -> BASE $21,090, $1,789 a year, $149 a month", () => {
    const r = at(or, 25_000_00, 1, { filingStatus: "single", allowances: 0 }, { federalWithholdingCents: 1_000_00 });
    expect(r.lines.baseCents).to.equal(21_090_00);
    expect(Math.round(r.lines.annualCents / 100)).to.equal(1_789);
    const monthly = at(or, Math.round(25_000_00 / 12), 12, { filingStatus: "single", allowances: 0 }, { federalWithholdingCents: Math.round(1_000_00 / 12) });
    expect(Math.round(monthly.stateCents / 100)).to.equal(149);
  });
  it("Example 3: $132,000 single -> federal subtraction limited to $5,250; allowances zeroed over $100,000", () => {
    const r = at(or, 132_000_00, 1, { filingStatus: "single", allowances: 4 }, { federalWithholdingCents: 21_098_00 });
    expect(r.lines.federalSubtractedCents).to.equal(5_250_00);
    expect(r.lines.allowances).to.equal(0);
  });
  it("Example 4: married at single rate, $175,000 -> no federal subtraction, no allowances", () => {
    const r = at(or, 175_000_00, 1, { filingStatus: "marriedWithholdAtSingle", allowances: 4 }, { federalWithholdingCents: 30_000_00 });
    expect(r.lines.federalSubtractedCents).to.equal(0);
    expect(r.lines.allowances).to.equal(0);
  });
  it("no OR-W-4: 8% of wages; needs federal withholding otherwise", () => {
    expect(at(or, 1_000_00, 52).stateCents).to.equal(80_00);
    expect(() => at(or, 1_000_00, 52, { filingStatus: "single", allowances: 0 })).to.throw(/federalWithholdingCents is required/);
  });
});

describe("Rhode Island (2026 booklet percentage method, generated tables)", () => {
  it("booklet example: $2,195 weekly, 1 exemption -> $87.57", () =>
    expect(at(ri, 2_195_00, 52, { exemptions: 1 }).stateCents).to.equal(87_57));
  it("reproduces every printed exemption amount and wage cutoff", () => {
    const e = (n) => ri.exemptionFor(ri.TABLES[2026], n);
    expect([52, 26, 24, 12, 4, 2, 1, 260].map((n) => e(n).amountCents)).to.deep.equal([19_23, 38_46, 41_67, 83_33, 250_00, 500_00, 1_000_00, 3_85]);
    expect([52, 26, 24, 12, 260].map((n) => e(n).cutoffCents)).to.deep.equal([5_592_31, 11_184_62, 12_116_67, 24_233_33, 1_118_46]);
  });
  it("exemptions are worth $0 above the cutoff", () =>
    expect(at(ri, 6_000_00, 52, { exemptions: 2 }).lines.exemptionEachCents).to.equal(0));
});

describe("Vermont (GB-1210-2026, generated tables)", () => {
  it("guide example: $1,800 weekly, married, 2 allowances -> $45.77", () =>
    expect(at(vt, 1_800_00, 52, { filingStatus: "married", allowances: 2 }).stateCents).to.equal(45_77));
  it("no W-4VT: a federal W-4's status, plus 30% of its extra withholding", () => {
    const r = at(vt, 1_800_00, 52, null, { federalW4: { formYear: 2024, filingStatus: "marriedFilingJointly", step4cExtraWithholdingCents: 10_00 } });
    expect(r.lines.status).to.equal("married");
    expect(r.stateCents).to.equal(Math.round((180_000 - 22_600) * 0.0335) + 3_00);
  });
});

describe("West Virginia (IT-100.2A, March 2026, generated tables)", () => {
  it("every bracket base follows from the bracket below, in both sets", () => {
    for (const set of Object.values(wv.TABLES[2026].percentageTables)) {
      for (const rows of Object.values(set)) basesChain(rows, 3); // printed edges are rounded to the dollar
    }
  });
  it("two-earner by default; one-earner when elected on the IT-104", () => {
    const base = { exemptions: 1 };
    expect(at(wv, 1_000_00, 52, base).lines.set).to.equal("twoEarner");
    expect(at(wv, 1_000_00, 52, { ...base, oneEarner: true }).stateCents).to.be.lessThan(at(wv, 1_000_00, 52, base).stateCents);
  });
  it("$1,000 weekly, two-earner, 1 exemption: $961.54 taxable -> $28.14 + 4.58% x $95.54", () =>
    expect(at(wv, 1_000_00, 52, { exemptions: 1 }).stateCents).to.equal(Math.round(28_14 + (96_154 - 86_600) * 0.0458)));
});

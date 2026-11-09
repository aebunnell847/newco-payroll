// Plain-English overview: states whose withholding is one flat rate after
// an allowance or standard deduction, checked against each state's own
// published formula and, where the state prints one, its worked example.

const { expect } = require("chai");
const { computeStateWithholdingCents } = require("../src/regulatory/state");
const co = require("../src/regulatory/state/co");
const ky = require("../src/regulatory/state/ky");
const mi = require("../src/regulatory/state/mi");
const nc = require("../src/regulatory/state/nc");

const at = (m, wagesCents, payPeriodsPerYear, form = null, extra = {}) =>
  m.compute({ taxYear: 2026, wagesCents, payPeriodsPerYear, form, ...extra });

describe("Kentucky (42A003 2026 formula)", () => {
  it("monthly example: $3,270 -> $104.65", () => expect(at(ky, 3_270_00, 12).stateCents).to.equal(104_65));

  it("biweekly example: $1,500 -> $47.98 (the sheet prints $1,247.40 / 26 as \"$47\")", () => {
    const r = at(ky, 1_500_00, 26);
    expect(r.lines.annualTaxCents).to.equal(1_247_40);
    expect(r.stateCents).to.equal(47_98);
  });

  it("honors the K-4 exemption and additional withholding", () => {
    expect(at(ky, 1_500_00, 26, { exempt: true }).stateCents).to.equal(0);
    expect(at(ky, 1_500_00, 26, { additionalWithholdingCents: 5_00 }).stateCents).to.equal(52_98);
  });

  it("has no 2024 figures (2025: test/state2025.test.js)", () => {
    expect(() =>
      computeStateWithholdingCents({ state: "KY", taxYear: 2024, grossPayCents: 1, federalTaxableWagesCents: 1, payPeriodsPerYear: 26 })
    ).to.throw(/Kentucky withholding for tax year 2024/);
  });
});

describe("Michigan (Form 446 direct percentage computation)", () => {
  it("4.25% after exemptions x $5,900 / pay periods (2026)", () => {
    // $2,000 biweekly, 2 exemptions: $2,000 - $11,800/26 = $1,546.15... x 4.25%
    expect(at(mi, 2_000_00, 26, { exemptions: 2 }).stateCents).to.equal(Math.round((200_000 - 1_180_000 / 26) * 0.0425));
  });

  it("uses $5,800 per exemption for 2025", () => {
    const r = mi.compute({ taxYear: 2025, wagesCents: 2_000_00, payPeriodsPerYear: 26, form: { exemptions: 1 } });
    expect(r.lines.allowanceCents).to.equal(580_000 / 26);
  });

  it("withholds on total compensation with zero exemptions when no MI-W4 is on file", () => {
    const r = at(mi, 2_000_00, 26);
    expect(r.stateCents).to.equal(85_00);
    expect(r.formBasis).to.equal("none-on-file-zero-exemptions");
  });
});

describe("Colorado (DR 1098 2026 worksheet)", () => {
  it("no certificate: as a single W-4 ($5,500), 4.40%", () => {
    // ($2,000 x 26 - $5,500) x 4.4% / 26 = $78.69
    const r = at(co, 2_000_00, 26);
    expect(r.stateCents).to.equal(78_69);
    expect(r.formBasis).to.equal("none-on-file-single");
  });

  it("federal W-4 married filing jointly: $11,000", () => {
    const w4 = { formYear: 2024, filingStatus: "marriedFilingJointly" };
    expect(at(co, 2_000_00, 26, null, { federalW4: w4 }).lines.line2aCents).to.equal(11_000_00);
  });

  it("federal W-4 claiming exempt: zero", () => {
    expect(at(co, 2_000_00, 26, null, { federalW4: { formYear: 2024, filingStatus: "single", exempt: true } }).stateCents).to.equal(0);
  });

  it("DR 0004 line 2 wins, including zero, and line 3 is added", () => {
    const r = at(co, 2_000_00, 26, { line2AllowanceCents: 0, additionalWithholdingCents: 10_00 });
    expect(r.stateCents).to.equal(Math.round((52_000_00 * 0.044) / 26) + 10_00);
    expect(r.formBasis).to.equal("dr-0004");
  });

  it("DR 0004 with line 2 blank falls back to the W-4 amount", () => {
    const w4 = { formYear: 2024, filingStatus: "marriedFilingJointly" };
    expect(at(co, 2_000_00, 26, { additionalWithholdingCents: 0 }, { federalW4: w4 }).lines.line2aCents).to.equal(11_000_00);
  });
});

describe("North Carolina (NC-30 2026 annualized method)", () => {
  it("NC-30 example: $450 weekly, single, 2 allowances -> $4.00", () => {
    const r = at(nc, 450_00, 52, { filingStatus: "single", allowances: 2 });
    expect(r.lines.netAnnualCents).to.equal(5_650_00);
    expect(r.stateCents).to.equal(4_00);
  });

  it("head of household uses $19,125; others $12,750", () => {
    expect(at(nc, 1_000_00, 52, { filingStatus: "headOfHousehold", allowances: 0 }).lines.standardDeductionCents).to.equal(19_125_00);
    expect(at(nc, 1_000_00, 52, { filingStatus: "married", allowances: 0 }).lines.standardDeductionCents).to.equal(12_750_00);
  });

  it("no NC-4: single with no allowances; rounds to whole dollars", () => {
    const r = at(nc, 1_000_00, 52);
    expect(r.formBasis).to.equal("none-on-file-single-zero");
    expect(r.stateCents % 100).to.equal(0);
  });

  it("rejects an NC-4 filing status it doesn't know", () => {
    expect(() => at(nc, 1, 52, { filingStatus: "marriedFilingJointly" })).to.throw(/NC-4: filingStatus/);
  });
});

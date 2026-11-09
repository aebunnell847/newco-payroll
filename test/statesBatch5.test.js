// Plain-English overview: Connecticut, Delaware, Hawaii and Maine
// withholding, each checked against its agency's worked examples.

const { expect } = require("chai");
const ct = require("../src/regulatory/state/ct");
const de = require("../src/regulatory/state/de");
const hi = require("../src/regulatory/state/hi");
const me = require("../src/regulatory/state/me");

const at = (m, wagesCents, payPeriodsPerYear, form = null, extra = {}) =>
  m.compute({ taxYear: 2026, wagesCents, payPeriodsPerYear, form, payDate: "2026-11-06", ...extra });

describe("Connecticut (TPG-211 calculation rules, generated tables)", () => {
  it("Circular CT examples (worked from wage-bracket tables) are within 50 cents below the exact rules", () => {
    const close = (got, printed) => {
      expect(got - printed).to.be.at.least(0);
      expect(got - printed).to.be.at.most(50);
    };
    close(at(ct, 700_00, 52, { code: "F" }).stateCents, 17_65);
    close(at(ct, 1_000_00, 52, { code: "A" }).stateCents, 39_97);
    close(at(ct, 2_300_00, 26, { code: "B" }).stateCents, 78_82);
  });

  it("code A, $52,000 a year, line by line: Table B $2,110 + Table C $25, x (1 - .02)", () => {
    const r = at(ct, 52_000_00, 1, { code: "A" });
    expect(r.lines).to.include({ exemptionCents: 0, initialCents: 2_110_00, addBackCents: 25_00, recaptureCents: 0, creditPct: 2 });
    expect(r.stateCents).to.equal(Math.round(2_135_00 * 0.98));
  });

  it("Table A exemption phases out ($24,000 code A -> $12,000; $35,000+ -> $0)", () => {
    expect(at(ct, 24_000_00, 1, { code: "A" }).lines.exemptionCents).to.equal(12_000_00);
    expect(at(ct, 36_000_00, 1, { code: "A" }).lines.exemptionCents).to.equal(0);
  });

  it("code D: no exemption and no credit; code E: exempt", () => {
    const r = at(ct, 30_000_00, 1, { code: "D" });
    expect(r.lines.exemptionCents).to.equal(0);
    expect(r.lines.creditPct).to.equal(0);
    expect(at(ct, 30_000_00, 1, { code: "E" }).stateCents).to.equal(0);
  });

  it("no CT-W4: 6.99% flat, no exemption", () => {
    const r = at(ct, 1_000_00, 52);
    expect(r.stateCents).to.equal(69_90);
    expect(r.formBasis).to.equal("none-on-file-6.99-percent");
  });

  it("line 3 reduction never takes withholding below zero", () => {
    expect(at(ct, 1_000_00, 52, { code: "A", reducedWithholdingCents: 100_00 }).stateCents).to.equal(0);
  });
});

describe("Delaware (Employer's Guide annualized formula)", () => {
  it("guide example: single, 1 allowance, $25,000 a year -> $722 ($13.88 weekly ... $60.17 monthly)", () => {
    const f = { filingStatus: "single", exemptions: 1 };
    expect(at(de, 25_000_00, 1, f).lines.annualTaxCents).to.equal(722_00);
    expect(at(de, Math.round(25_000_00 / 52), 52, f).stateCents).to.be.closeTo(13_88, 1);
    expect(at(de, 25_000_00 / 12, 12, f).stateCents).to.equal(60_17);
  });
  it("no certificate: single, no allowances; a pre-2020 federal W-4 supplies them", () => {
    expect(at(de, 1_000_00, 52).formBasis).to.equal("none-on-file-single-zero");
    expect(at(de, 1_000_00, 52, null, { federalW4: { formYear: 2018, maritalStatus: "married", allowances: 2 } }).formBasis).to.equal("federal-w4-pre-2020");
  });
  it("daily payroll uses 300 periods", () => expect(at(de, 200_00, 260).lines.P).to.equal(300));
});

describe("Hawaii (Booklet A annualized method)", () => {
  it("booklet example: $500 weekly, single, 3 allowances -> $497.99 a year, $9.58", () => {
    const r = at(hi, 500_00, 52, { filingStatus: "single", allowances: 3 });
    expect(r.lines.subjectCents).to.equal(18_218_00);
    expect(r.lines.annualTaxCents).to.be.closeTo(497_99, 0.5);
    expect(r.stateCents).to.equal(9_58);
  });
  it("matches the Part 2 weekly allowance values ($22.00, $83.65)", () => {
    expect(Math.round(hi.TABLES[2026].allowanceCents / 52)).to.equal(22_00);
    expect(Math.round(hi.TABLES[2026].extraAllowanceCents / 52)).to.equal(83_65);
  });
  it("no HW-4: single, no allowances", () => expect(at(hi, 500_00, 52).formBasis).to.equal("none-on-file-single-zero"));
});

describe("Maine (withholding tables, revised August 2026)", () => {
  it("Example 1: $300 weekly, single, 2 allowances -> $0", () =>
    expect(at(me, 300_00, 52, { filingStatus: "single", allowances: 2 }).stateCents).to.equal(0));
  it("Example 2: $1,000 weekly, single, 2 allowances -> $32", () =>
    expect(at(me, 1_000_00, 52, { filingStatus: "single", allowances: 2 }).stateCents).to.equal(32_00));
  it("Example 3: $4,500 weekly, married, 2 allowances -> standard deduction $22,945, $256", () => {
    const r = at(me, 4_500_00, 52, { filingStatus: "married", allowances: 2 });
    expect(Math.round(r.lines.standardDeductionCents / 100)).to.equal(22_945);
    expect(r.stateCents).to.equal(256_00);
  });
  it("adds the 2% surcharge over $1,000,000 single", () => {
    const r = at(me, 1_100_000_00, 1, { filingStatus: "single", allowances: 0 });
    const base = 4_117_00 + (1_100_000_00 - 64_850_00) * 0.0715;
    expect(r.lines.annualTaxCents).to.be.closeTo(base + 100_000_00 * 0.02, 1);
  });
  it("no W-4ME: single, no allowances", () => expect(at(me, 1_000_00, 52).formBasis).to.equal("none-on-file-single-zero"));
});

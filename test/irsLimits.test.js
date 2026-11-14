// Plain-English overview: pins every IRS figure in src/regulatory/irsLimits.js
// to the value in its cited source, so a typo in the table fails CI instead
// of quietly changing how much someone can save. If the IRS publishes a new
// year, add its numbers here alongside the table entry.

const { expect } = require("chai");
const {
  IRS_DEFERRAL_LIMITS,
  getDeferralLimits,
  catchUpBand,
  annualDeferralCapCents,
  rothCatchUpRequired,
} = require("../src/regulatory/irsLimits");

describe("IRS deferral limits table", () => {
  it("matches IRS Notice 2026-66 for 2027", () => {
    const l = getDeferralLimits(2027);
    expect(l.taxYear).to.equal(2027);
    expect(l.electiveDeferralLimitCents).to.equal(25_500_00);
    expect(l.catchUpLimitCents).to.equal(8_500_00);
    expect(l.catchUpLimitAge60to63Cents).to.equal(11_750_00);
    expect(l.rothCatchUpRequirementApplies).to.equal(true);
    expect(l.rothCatchUpWageThresholdCents).to.equal(155_000_00);
    expect(l.annualAdditionsLimitCents).to.equal(75_000_00);
    expect(l.compensationLimitCents).to.equal(375_000_00);
    expect(l.sources.join(" ")).to.contain("n-26-66.pdf");
  });

  it("2026 entry equals the 'increased from' figures Notice 2026-66 states", () => {
    // The notice states each 2027 limit as an increase from the 2026 one;
    // this cross-checks the 2026 entry against a second IRS source.
    const l = getDeferralLimits(2026);
    expect(l.electiveDeferralLimitCents).to.equal(24_500_00);
    expect(l.catchUpLimitCents).to.equal(8_000_00);
    expect(l.catchUpLimitAge60to63Cents).to.equal(11_250_00);
    expect(l.rothCatchUpWageThresholdCents).to.equal(150_000_00);
    expect(l.annualAdditionsLimitCents).to.equal(72_000_00);
    expect(l.compensationLimitCents).to.equal(360_000_00);
  });

  it("matches IRS Notice 2025-67 for 2026", () => {
    const l = getDeferralLimits(2026);
    expect(l.electiveDeferralLimitCents).to.equal(24_500_00);
    expect(l.catchUpLimitCents).to.equal(8_000_00);
    expect(l.catchUpLimitAge60to63Cents).to.equal(11_250_00);
    expect(l.rothCatchUpRequirementApplies).to.equal(true);
    expect(l.rothCatchUpWageThresholdCents).to.equal(150_000_00);
    expect(l.annualAdditionsLimitCents).to.equal(72_000_00);
    expect(l.compensationLimitCents).to.equal(360_000_00);
  });

  it("matches IRS Publications 560/17 and Notice 2025-67 for 2025", () => {
    const l = getDeferralLimits(2025);
    expect(l.electiveDeferralLimitCents).to.equal(23_500_00);
    expect(l.catchUpLimitCents).to.equal(7_500_00);
    expect(l.catchUpLimitAge60to63Cents).to.equal(11_250_00);
    expect(l.rothCatchUpRequirementApplies).to.equal(false);
    expect(l.annualAdditionsLimitCents).to.equal(70_000_00);
    expect(l.compensationLimitCents).to.equal(350_000_00);
  });

  it("cites an irs.gov source for every year", () => {
    for (const limits of Object.values(IRS_DEFERRAL_LIMITS)) {
      expect(limits.sources.length).to.be.greaterThan(0);
      for (const source of limits.sources) expect(source).to.match(/https:\/\/www\.irs\.gov\//);
    }
  });

  it("is frozen, so no caller can change a limit at runtime", () => {
    expect(Object.isFrozen(IRS_DEFERRAL_LIMITS)).to.equal(true);
    expect(Object.isFrozen(getDeferralLimits(2026))).to.equal(true);
  });

  it("throws for a year it has no source for, instead of falling back", () => {
    expect(() => getDeferralLimits(2024)).to.throw(/no sourced IRS deferral limits for tax year 2024/);
    expect(() => getDeferralLimits(2028)).to.throw(/no sourced IRS deferral limits for tax year 2028/);
    expect(() => getDeferralLimits("2026")).to.throw(/integer year/);
  });
});

describe("catchUpBand (age attained by the end of the tax year)", () => {
  const cases = [
    [1977, "none"], // 49
    [1976, "standard"], // 50
    [1967, "standard"], // 59
    [1966, "age60to63"], // 60
    [1963, "age60to63"], // 63
    [1962, "standard"], // 64: back to the standard catch-up
  ];
  for (const [birthYear, band] of cases) {
    it(`born ${birthYear} -> ${band} in 2026`, () => {
      expect(catchUpBand(2026, birthYear)).to.equal(band);
    });
  }

  it("never assumes catch-up without a birth year", () => {
    expect(catchUpBand(2026, undefined)).to.equal("none");
    expect(catchUpBand(2026, null)).to.equal("none");
  });

  it("rejects a birth year after the tax year", () => {
    expect(() => catchUpBand(2026, 2030)).to.throw(/birthYear/);
  });
});

describe("annualDeferralCapCents", () => {
  it("is the base limit when the plan doesn't offer catch-up, whatever the age", () => {
    const cap = annualDeferralCapCents({ taxYear: 2026, birthYear: 1964 });
    expect(cap.totalCents).to.equal(24_500_00);
  });

  it("adds $11,250 for ages 60-63 when the plan offers catch-up", () => {
    const cap = annualDeferralCapCents({ taxYear: 2026, birthYear: 1964, planAllowsCatchUp: true });
    expect(cap.totalCents).to.equal(24_500_00 + 11_250_00);
    expect(cap.catchUpBand).to.equal("age60to63");
  });

  it("2027: $25,500 + $11,750 for someone who turns 60 in 2027", () => {
    const cap = annualDeferralCapCents({ taxYear: 2027, birthYear: 1967, planAllowsCatchUp: true });
    expect(cap.catchUpBand).to.equal("age60to63");
    expect(cap.totalCents).to.equal(25_500_00 + 11_750_00);
  });

  it("2027: $25,500 + $8,500 for someone who turns 64 in 2027", () => {
    const cap = annualDeferralCapCents({ taxYear: 2027, birthYear: 1963, planAllowsCatchUp: true });
    expect(cap.catchUpBand).to.equal("standard");
    expect(cap.totalCents).to.equal(25_500_00 + 8_500_00);
  });
});

describe("rothCatchUpRequired", () => {
  it("doesn't apply in 2025 (IRS transition period)", () => {
    expect(
      rothCatchUpRequired({ taxYear: 2025, catchUpPortionCents: 100, priorYearFicaWagesCents: 999_999_99 })
    ).to.equal(false);
  });

  it("2027 uses the $155,000 threshold on 2026 FICA wages (strictly greater than)", () => {
    const at = { taxYear: 2027, catchUpPortionCents: 100 };
    expect(rothCatchUpRequired({ ...at, priorYearFicaWagesCents: 155_000_00 })).to.equal(false);
    expect(rothCatchUpRequired({ ...at, priorYearFicaWagesCents: 155_000_01 })).to.equal(true);
    // Between the 2026 and 2027 thresholds: Roth would be required under the
    // 2026 figure but not the 2027 one.
    expect(rothCatchUpRequired({ ...at, priorYearFicaWagesCents: 152_000_00 })).to.equal(false);
    expect(rothCatchUpRequired({ ...at, priorYearFicaWagesCents: undefined })).to.equal(null);
  });
});

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
});

describe("rothCatchUpRequired", () => {
  it("doesn't apply in 2025 (IRS transition period)", () => {
    expect(
      rothCatchUpRequired({ taxYear: 2025, catchUpPortionCents: 100, priorYearFicaWagesCents: 999_999_99 })
    ).to.equal(false);
  });
});

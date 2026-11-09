// Plain-English overview: pins the FICA figures to IRS Publication 15 and
// checks the two year-to-date edges that make FICA more than a flat rate:
// the Social Security wage base and the Additional Medicare threshold.

const { expect } = require("chai");
const { FICA, computeFicaCents } = require("../src/regulatory/fica");

describe("FICA rates (IRS Publication 15)", () => {
  it("matches Pub 15 (2026) and (2025)", () => {
    expect(FICA[2026]).to.include({
      socialSecurityRateBp: 620,
      socialSecurityWageBaseCents: 184_500_00,
      medicareRateBp: 145,
      additionalMedicareRateBp: 90,
      additionalMedicareThresholdCents: 200_000_00,
    });
    expect(FICA[2025].socialSecurityWageBaseCents).to.equal(176_100_00);
    for (const y of [2025, 2026]) expect(FICA[y].sources[0]).to.match(/https:\/\/www\.irs\.gov\//);
  });

  it("refuses a year with no sourced rates", () => {
    expect(() => computeFicaCents({ taxYear: 2027, ficaWagesCents: 1 })).to.throw(/no sourced FICA rates/);
  });
});

describe("computeFicaCents", () => {
  it("takes 6.2% and 1.45% of an ordinary paycheck", () => {
    const r = computeFicaCents({ taxYear: 2026, ficaWagesCents: 400_000 });
    expect(r).to.include({ socialSecurityCents: 24_800, medicareCents: 5_800, additionalMedicareCents: 0, totalCents: 30_600 });
  });

  it("taxes only the part of a paycheck under the Social Security wage base", () => {
    // $180,000 paid so far: $4,500 of room left under $184,500.
    const r = computeFicaCents({ taxYear: 2026, ficaWagesCents: 10_000_00, yearToDateFicaWagesCents: 180_000_00 });
    expect(r.socialSecurityWagesCents).to.equal(4_500_00);
    expect(r.socialSecurityCents).to.equal(27_900);
    expect(r.medicareCents).to.equal(14_500); // Medicare has no wage base
  });

  it("uses each year's own wage base", () => {
    const r = computeFicaCents({ taxYear: 2025, ficaWagesCents: 10_000_00, yearToDateFicaWagesCents: 180_000_00 });
    expect(r.socialSecurityCents).to.equal(0); // already past 2025's $176,100
  });

  it("withholds Additional Medicare only on wages over $200,000 in the year", () => {
    const r = computeFicaCents({ taxYear: 2026, ficaWagesCents: 10_000_00, yearToDateFicaWagesCents: 195_000_00 });
    expect(r.additionalMedicareWagesCents).to.equal(5_000_00);
    expect(r.additionalMedicareCents).to.equal(4_500);
    const after = computeFicaCents({ taxYear: 2026, ficaWagesCents: 10_000_00, yearToDateFicaWagesCents: 250_000_00 });
    expect(after.additionalMedicareCents).to.equal(9_000);
  });

  it("rejects fractional or negative cents", () => {
    expect(() => computeFicaCents({ taxYear: 2026, ficaWagesCents: 10.5 })).to.throw(/integer/);
    expect(() => computeFicaCents({ taxYear: 2026, ficaWagesCents: 1, yearToDateFicaWagesCents: -1 })).to.throw(/integer/);
  });
});

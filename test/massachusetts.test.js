// Plain-English overview: Massachusetts withholding from Circular M (2026),
// cross-checked against the printed weekly wage-bracket table.

const { expect } = require("chai");
const ma = require("../src/regulatory/state/ma");

const weekly = (wagesCents, form, extra = {}) =>
  ma.compute({ taxYear: 2026, wagesCents, payPeriodsPerYear: 52, form, ficaCents: Math.round(wagesCents * 0.0765), ...extra });

describe("Massachusetts (Circular M, 2026 percentage method)", () => {
  // The wage-bracket table brackets the wage (checked here at the row's
  // midpoint) and appears to use the unrounded $1,000 / 52 per exemption,
  // where the percentage method uses $19; so the two agree to 3 cents at up
  // to 5 exemptions and drift by about 1 cent per exemption beyond that.
  it("matches the printed 2026 weekly table (3 cents; 10 at 9-10 exemptions)", () => {
    // [row midpoint, exemptions, printed amount]
    const printed = [
      [155_00, 0, 7_16], [155_00, 1, 2_93], [155_00, 2, 1_96], [155_00, 3, 1_00], [155_00, 4, 4],
      [205_00, 0, 9_47], [205_00, 5, 1_39],
      [305_00, 0, 14_08], [305_00, 4, 6_97], [305_00, 10, 1_20],
      [325_00, 1, 10_78], [325_00, 9, 3_08],
    ];
    for (const [w, n, amount] of printed) {
      expect(Math.abs(weekly(w, { exemptions: n }).stateCents - amount), `${w} / ${n}`).to.be.at.most(n >= 9 ? 10 : 3);
    }
  });

  it("exemption factors: claiming 1 = $85 weekly; more = $19 x n + $66 ... $1,000 x n + $3,400 a year", () => {
    const pv = ma.TABLES[2026].periodValues;
    expect(ma.exemptionFactorCents(pv.weekly, 1)).to.equal(85_00);
    expect(ma.exemptionFactorCents(pv.biweekly, 1)).to.equal(169_00);
    expect(ma.exemptionFactorCents(pv.semimonthly, 1)).to.equal(183_00);
    expect(ma.exemptionFactorCents(pv.monthly, 1)).to.equal(367_00);
    expect(ma.exemptionFactorCents(pv.daily, 1)).to.equal(12_00);
    expect(ma.exemptionFactorCents(pv.annual, 1)).to.equal(4_400_00);
    expect(ma.exemptionFactorCents(pv.weekly, 0)).to.equal(0);
  });

  it("subtracts FICA only up to $2,000 a year", () => {
    const early = weekly(1_000_00, { exemptions: 0 });
    expect(early.lines.ficaSubtractedCents).to.equal(76_50);
    const late = weekly(1_000_00, { exemptions: 0 }, { yearToDateFicaWagesCents: 26_100_00 }); // $1,996.65 already
    expect(late.lines.ficaSubtractedCents).to.equal(3_35);
    const done = weekly(1_000_00, { exemptions: 0 }, { yearToDateFicaWagesCents: 30_000_00 });
    expect(done.lines.ficaSubtractedCents).to.equal(0);
  });

  it("head of household and blindness reduce the period's tax by their tax values", () => {
    const base = weekly(1_000_00, { exemptions: 1 }).stateCents;
    expect(weekly(1_000_00, { exemptions: 1, headOfHousehold: true }).stateCents).to.equal(base - 2_31);
    expect(weekly(1_000_00, { exemptions: 1, blindCount: 2 }).stateCents).to.equal(base - 2 * 2_12);
  });

  it("applies the 9% surtax rate above $1,107,750 a year", () => {
    const r = ma.compute({ taxYear: 2026, wagesCents: 1_200_000_00, payPeriodsPerYear: 1, form: { exemptions: 0 }, ficaCents: 0, yearToDateFicaWagesCents: 30_000_00 });
    expect(r.lines.annualTaxCents).to.equal(1_107_750_00 * 0.05 + (1_200_000_00 - 1_107_750_00) * 0.09);
  });

  it("doesn't withhold under the floor when exemptions are claimed; no M-4: zero exemptions", () => {
    expect(weekly(150_00, { exemptions: 1 }).stateCents).to.equal(0);
    expect(weekly(150_00, null).formBasis).to.equal("none-on-file-zero-exemptions");
    expect(weekly(150_00, null).stateCents).to.be.greaterThan(0);
  });

  it("gets employee FICA from the payroll engine", () => {
    const { computeTaxWithholdingCents } = require("../src/payroll/payrollEngine");
    const r = computeTaxWithholdingCents({
      taxYear: 2026,
      grossPayCents: 1_000_00,
      payPeriodsPerYear: 52,
      workState: "MA",
      stateW4: { exemptions: 1 },
      payDate: "2026-11-13",
    });
    expect(r.stateCents).to.equal(Math.round((1_000_00 - r.ficaCents - 85_00) * 0.05));
  });
});

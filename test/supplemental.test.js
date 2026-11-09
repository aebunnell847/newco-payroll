// Plain-English overview: supplemental pay (bonuses) - Publication 15,
// section 7. Bonuses are added to gross pay; federal tax is either
// aggregated with regular pay (default) or a flat 22% (plan election), and
// supplemental wages above $1 million in the year always take 37%.

const { expect } = require("chai");
const { computeGrossPayCents, computeTaxWithholdingCents, runPayrollForEmployee } = require("../src/payroll/payrollEngine");
const { computeFederalWithholdingCents } = require("../src/regulatory/federalWithholding");
const { getSupplementalRules } = require("../src/regulatory/supplemental");

const base = { taxYear: 2026, payPeriodsPerYear: 26, workState: "TX", payDate: "2026-12-18" };
const fed = (taxableWagesCents, w4) => computeFederalWithholdingCents({ taxYear: 2026, taxableWagesCents, payPeriodsPerYear: 26, w4 }).federalCents;

describe("supplemental pay: gross", () => {
  it("adds the bonus to regular pay", () => {
    const e = { payType: "salary", annualSalaryCents: 52_000_00, payPeriodsPerYear: 26 };
    expect(computeGrossPayCents(e, { supplementalCents: 500_00 })).to.equal(2_500_00);
  });

  it("rejects fractional or negative amounts", () => {
    const e = { payType: "salary", annualSalaryCents: 52_000_00, payPeriodsPerYear: 26 };
    expect(() => computeGrossPayCents(e, { supplementalCents: -1 })).to.throw(/non-negative integer/);
    expect(() => computeGrossPayCents(e, { supplementalCents: 1.5 })).to.throw(/non-negative integer/);
  });

  it("has no rules for a year nobody sourced", () => {
    expect(() => getSupplementalRules(2024)).to.throw(/no sourced federal supplemental-wage rules for tax year 2024/);
  });
});

describe("supplemental pay: federal income tax", () => {
  it("aggregate (default): withholds on regular + bonus as one payment", () => {
    const r = computeTaxWithholdingCents({ ...base, grossPayCents: 3_000_00, supplementalCents: 1_000_00 });
    expect(r.federalCents).to.equal(fed(3_000_00));
    expect(r.federalSupplemental).to.include({ method: "aggregate", flatCents: 0, mandatoryCents: 0 });
  });

  it("flat: regular pay on the tables, the bonus at exactly 22%", () => {
    const r = computeTaxWithholdingCents({ ...base, grossPayCents: 3_000_00, supplementalCents: 1_000_00, supplementalMethod: "flat" });
    expect(r.federalSupplemental.flatCents).to.equal(220_00);
    expect(r.federalCents).to.equal(fed(2_000_00) + 220_00);
  });

  it("shares a pre-tax 401(k) deferral in proportion between regular and bonus", () => {
    // $300 deferral on $3,000 gross: $100 of it comes off the $1,000 bonus.
    const r = computeTaxWithholdingCents({
      ...base,
      grossPayCents: 3_000_00,
      preTaxDeductionsCents: 300_00,
      supplementalCents: 1_000_00,
      supplementalMethod: "flat",
    });
    expect(r.federalSupplemental.supplementalTaxableCents).to.equal(900_00);
    expect(r.federalCents).to.equal(fed(1_800_00) + 198_00);
  });

  it("37% on supplemental wages above $1 million for the year, whatever the method", () => {
    // $900,000 already paid in bonuses; a $300,000 bonus: $200,000 of it is over the line.
    for (const supplementalMethod of ["aggregate", "flat"]) {
      const r = computeTaxWithholdingCents({
        ...base,
        grossPayCents: 302_000_00,
        supplementalCents: 300_000_00,
        yearToDateSupplementalCents: 900_000_00,
        supplementalMethod,
      });
      expect(r.federalSupplemental.mandatoryTaxableCents).to.equal(200_000_00);
      expect(r.federalSupplemental.mandatoryCents).to.equal(74_000_00);
      const rest = supplementalMethod === "flat" ? fed(2_000_00) + 22_000_00 : fed(102_000_00);
      expect(r.federalCents).to.equal(rest + 74_000_00);
    }
  });

  it("the whole bonus takes 37% once the year is already past $1 million", () => {
    const r = computeTaxWithholdingCents({
      ...base,
      grossPayCents: 52_000_00,
      supplementalCents: 50_000_00,
      yearToDateSupplementalCents: 1_200_000_00,
      supplementalMethod: "flat",
    });
    expect(r.federalSupplemental).to.include({ mandatoryTaxableCents: 50_000_00, mandatoryCents: 18_500_00, flatCents: 0 });
  });

  it("the 37% ignores an exempt Form W-4; the 22% doesn't apply to an employee with no income tax withheld", () => {
    const w4 = { formYear: 2026, filingStatus: "single", exempt: true };
    const r = computeTaxWithholdingCents({
      ...base,
      w4,
      grossPayCents: 102_000_00,
      supplementalCents: 100_000_00,
      yearToDateSupplementalCents: 950_000_00,
      supplementalMethod: "flat",
    });
    expect(r.federalSupplemental).to.include({ flatCents: 0, mandatoryCents: 18_500_00 });
    expect(r.federalCents).to.equal(18_500_00);
  });

  it("rejects an unknown method", () => {
    expect(() => computeTaxWithholdingCents({ ...base, grossPayCents: 3_000_00, supplementalCents: 1_000_00, supplementalMethod: "25%" })).to.throw(
      /supplementalMethod must be one of aggregate, flat/
    );
  });

  it("states and FICA see the combined pay", () => {
    const r = computeTaxWithholdingCents({ ...base, workState: "PA", grossPayCents: 3_000_00, supplementalCents: 1_000_00 });
    expect(r.stateCents).to.equal(Math.round(3_000_00 * 0.0307));
    expect(r.ficaCents).to.equal(Math.round(3_000_00 * 0.062) + Math.round(3_000_00 * 0.0145));
  });
});

describe("supplemental pay: runs", () => {
  it("runPayrollForEmployee uses the plan's method and reports the bonus", () => {
    const e = { id: "e", payType: "salary", annualSalaryCents: 52_000_00, payPeriodsPerYear: 26, deferralElectionPct: 0, workState: "TX" };
    const pp = { id: "p", taxYear: 2026, payDate: "2026-12-18", supplementalCents: 1_000_00 };
    const r = runPayrollForEmployee(e, pp, 0, { supplementalMethod: "flat" });
    expect(r.grossPayCents).to.equal(3_000_00);
    expect(r.supplementalCents).to.equal(1_000_00);
    expect(r.taxWithholding.federalCents).to.equal(fed(2_000_00) + 220_00);
  });

  it("stored: bonuses are recorded per period and summed into year-to-date for the $1M rule", async () => {
    const { openPayrollStore } = require("../src/data/payrollStore");
    const { runStoredPayroll } = require("../src/payroll/storedPayrollRun");
    const store = openPayrollStore();
    try {
      store.upsertEmployee({ id: "ceo", payType: "salary", annualSalaryCents: 52_000_00, payPeriodsPerYear: 26, workState: "TX" });
      store.createPayPeriod({ id: "P24", periodStart: "2026-11-09", periodEnd: "2026-11-22", payDate: "2026-11-27" });
      store.createPayPeriod({ id: "P25", periodStart: "2026-11-23", periodEnd: "2026-12-06", payDate: "2026-12-11" });
      store.setSupplemental("ceo", "P24", 900_000_00);
      store.setSupplemental("ceo", "P25", 300_000_00);
      expect(store.getSupplemental("ceo", "P25")).to.equal(300_000_00);

      await runStoredPayroll(store, "P24");
      expect(store.getResult("ceo", "P24")).to.include({ grossPayCents: 902_000_00, supplementalCents: 900_000_00 });
      expect(() => store.setSupplemental("ceo", "P24", 1)).to.throw(/already paid/);
      expect(store.yearToDateSupplementalCents("ceo", 2026)).to.equal(900_000_00);

      await runStoredPayroll(store, "P25");
      const p25 = store.getResult("ceo", "P25");
      // $200,000 of the second bonus is over $1M: 37% of it, plus the rest aggregated.
      expect(p25.federalWithholdingCents).to.equal(fed(102_000_00) + 74_000_00);
      expect(store.yearToDateSupplementalCents("ceo", 2026)).to.equal(1_200_000_00);
    } finally {
      store.close();
    }
  });
});

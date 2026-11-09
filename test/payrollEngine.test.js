// Plain-English overview: these tests prove the payroll math is correct
// and deterministic, with no blockchain, network, or database involved.
// If these pass, the arithmetic NewCo would eventually hand to the
// ReconciliationLedger smart contract is trustworthy; if they fail, nothing
// downstream should be trusted either.

const { expect } = require("chai");
const {
  computeGrossPayCents,
  computeTaxWithholdingCents,
  compute401kDeferralCents,
  runPayrollForEmployee,
} = require("../src/payroll/payrollEngine");

describe("computeGrossPayCents", () => {
  it("divides a salaried employee's annual salary evenly across pay periods", () => {
    const employee = { payType: "salary", annualSalaryCents: 120_000_00, payPeriodsPerYear: 24 };
    const grossCents = computeGrossPayCents(employee, { id: "pp-1" });
    expect(grossCents).to.equal(500_000); // $120,000 / 24 = $5,000.00
  });

  it("pays an hourly employee regular hours at their base rate", () => {
    const employee = { payType: "hourly", hourlyRateCents: 2500 }; // $25.00/hr
    const grossCents = computeGrossPayCents(employee, { id: "pp-1", regularHours: 40, overtimeHours: 0 });
    expect(grossCents).to.equal(100_000); // 40 * $25 = $1,000.00
  });

  it("pays overtime hours at 1.5x the base rate", () => {
    const employee = { payType: "hourly", hourlyRateCents: 2000 }; // $20.00/hr
    const grossCents = computeGrossPayCents(employee, { id: "pp-1", regularHours: 40, overtimeHours: 5 });
    // 40 * $20 = $800.00 regular, 5 * $20 * 1.5 = $150.00 overtime
    expect(grossCents).to.equal(80_000 + 15_000);
  });

  it("rejects an employee with an unrecognized pay type", () => {
    expect(() => computeGrossPayCents({ payType: "bitcoin" }, {})).to.throw(/unknown payType/);
  });

  it("rejects a salaried employee missing required fields", () => {
    expect(() => computeGrossPayCents({ payType: "salary" }, {})).to.throw(/missing/);
  });
});

describe("computeTaxWithholdingCents", () => {
  const base = {
    taxYear: 2026,
    grossPayCents: 400_000, // $4,000 biweekly
    payPeriodsPerYear: 26,
    w4: { formYear: 2026, filingStatus: "single" },
    workState: "TX",
  };

  it("withholds federal tax on gross minus pre-tax deductions, per Pub 15-T", () => {
    const w = computeTaxWithholdingCents({ ...base, preTaxDeductionsCents: 20_000 });
    // ($3,800 x 26 - $8,600) = $90,200 -> $5,800 + 22% x $32,300 = $12,906 / 26
    expect(w.federalTaxableWagesCents).to.equal(380_000);
    expect(w.federalCents).to.equal(49_638);
    expect(w.w4Basis).to.equal("form-2020-or-later");
  });

  it("takes FICA on gross pay: pre-tax 401(k) deferrals don't reduce it", () => {
    const w = computeTaxWithholdingCents({ ...base, preTaxDeductionsCents: 20_000 });
    expect(w.socialSecurityCents).to.equal(24_800); // 6.2% of $4,000
    expect(w.medicareCents).to.equal(5_800); // 1.45% of $4,000
    expect(w.additionalMedicareCents).to.equal(0);
    expect(w.ficaCents).to.equal(30_600);
  });

  it("withholds state tax by the work state's own method and wage basis", () => {
    const tx = computeTaxWithholdingCents({ ...base, preTaxDeductionsCents: 20_000 });
    expect(tx.stateCents).to.equal(0);
    // PA taxes gross (401(k) deferrals included): 3.07% x $4,000
    const pa = computeTaxWithholdingCents({ ...base, preTaxDeductionsCents: 20_000, workState: "PA" });
    expect(pa.stateWagesCents).to.equal(400_000);
    expect(pa.stateCents).to.equal(12_280);
    // IL excludes pre-tax deferrals and, with no IL-W-4, allows no exemptions: 4.95% x $3,800
    const il = computeTaxWithholdingCents({ ...base, preTaxDeductionsCents: 20_000, workState: "IL" });
    expect(il.stateWagesCents).to.equal(380_000);
    expect(il.stateCents).to.equal(18_810);
    expect(il.stateFormBasis).to.equal("none-on-file");
    expect(il.totalCents).to.equal(il.federalCents + il.ficaCents + il.stateCents);
  });

  it("refuses to guess a state it has no sourced method for", () => {
    expect(() => computeTaxWithholdingCents({ ...base, workState: "OR" })).to.throw(/no sourced withholding method for state "OR"/);
    expect(() => computeTaxWithholdingCents({ ...base, workState: undefined })).to.throw(/no work state on file/);
  });

  it("uses the IRS default (Single, no adjustments) when no W-4 is on file", () => {
    const none = computeTaxWithholdingCents({ ...base, w4: null });
    const single = computeTaxWithholdingCents(base);
    expect(none.federalCents).to.equal(single.federalCents);
    expect(none.w4Basis).to.equal("none-on-file");
  });

  it("refuses to annualize without a pay frequency", () => {
    expect(() => computeTaxWithholdingCents({ ...base, payPeriodsPerYear: undefined })).to.throw(/payPeriodsPerYear/);
  });
});

describe("compute401kDeferralCents", () => {
  const Y2026 = { taxYear: 2026 };
  const LIMIT_2026 = 24_500_00; // IRS Notice 2025-67

  it("defers the elected percentage of gross pay when there's room under the annual limit", () => {
    const employee = { deferralElectionPct: 10 };
    const result = compute401kDeferralCents(100_000, employee, 0, Y2026); // $1,000 gross, 10%, $0 YTD
    expect(result.requestedCents).to.equal(10_000);
    expect(result.actualCents).to.equal(10_000);
    expect(result.cappedByAnnualLimit).to.equal(false);
    expect(result.annualLimitCents).to.equal(LIMIT_2026);
  });

  it("caps the deferral at whatever room remains under the year's IRS limit", () => {
    const employee = { deferralElectionPct: 50 };
    const alreadyDeferredCents = LIMIT_2026 - 5_000; // only $50.00 of room left
    const result = compute401kDeferralCents(100_000, employee, alreadyDeferredCents, Y2026); // would request $500
    expect(result.requestedCents).to.equal(50_000);
    expect(result.actualCents).to.equal(5_000);
    expect(result.cappedByAnnualLimit).to.equal(true);
  });

  it("defers nothing once the annual limit is already fully used", () => {
    const employee = { deferralElectionPct: 10 };
    const result = compute401kDeferralCents(100_000, employee, LIMIT_2026, Y2026);
    expect(result.actualCents).to.equal(0);
    expect(result.cappedByAnnualLimit).to.equal(true);
  });

  it("uses the limit for the pay date's tax year, not a single hardcoded number", () => {
    const employee = { deferralElectionPct: 100 };
    const ytd = 23_500_00; // exactly the 2025 limit
    expect(compute401kDeferralCents(100_000, employee, ytd, { taxYear: 2025 }).actualCents).to.equal(0);
    expect(compute401kDeferralCents(100_000, employee, ytd, Y2026).actualCents).to.equal(100_000);
  });

  it("refuses to run without a tax year, or for a year with no sourced limits", () => {
    expect(() => compute401kDeferralCents(100_000, { deferralElectionPct: 5 }, 0)).to.throw(/taxYear is required/);
    expect(() => compute401kDeferralCents(100_000, { deferralElectionPct: 5 }, 0, { taxYear: 2031 })).to.throw(
      /no sourced IRS deferral limits for tax year 2031/
    );
  });

  it("adds catch-up room only when the plan allows it and the employee is old enough", () => {
    const over50 = { deferralElectionPct: 100, birthYear: 1971 }; // 55 at end of 2026
    const atLimit = LIMIT_2026;

    const noPlanCatchUp = compute401kDeferralCents(100_000, over50, atLimit, Y2026);
    expect(noPlanCatchUp.actualCents).to.equal(0);
    expect(noPlanCatchUp.catchUpBand).to.equal("none");

    const withCatchUp = compute401kDeferralCents(100_000, over50, atLimit, { ...Y2026, planAllowsCatchUp: true });
    expect(withCatchUp.annualLimitCents).to.equal(LIMIT_2026 + 8_000_00);
    expect(withCatchUp.actualCents).to.equal(100_000);
    expect(withCatchUp.catchUpBand).to.equal("standard");
    expect(withCatchUp.catchUpPortionCents).to.equal(100_000);

    const under50 = { deferralElectionPct: 100, birthYear: 1990 };
    expect(
      compute401kDeferralCents(100_000, under50, atLimit, { ...Y2026, planAllowsCatchUp: true }).actualCents
    ).to.equal(0);
  });

  it("counts only the dollars above the base limit as catch-up", () => {
    const over50 = { deferralElectionPct: 100, birthYear: 1971 };
    const result = compute401kDeferralCents(100_000, over50, LIMIT_2026 - 30_000, {
      ...Y2026,
      planAllowsCatchUp: true,
    });
    expect(result.actualCents).to.equal(100_000);
    expect(result.catchUpPortionCents).to.equal(70_000); // $300 under the base limit, $700 over it
  });

  it("reports whether catch-up dollars must be Roth, and says 'unknown' rather than guessing", () => {
    const opts = { ...Y2026, planAllowsCatchUp: true };
    const base = { deferralElectionPct: 100, birthYear: 1971 };
    const run = (extra) => compute401kDeferralCents(100_000, { ...base, ...extra }, LIMIT_2026, opts);

    expect(run({ priorYearFicaWagesCents: 150_000_01 }).rothCatchUpRequired).to.equal(true);
    expect(run({ priorYearFicaWagesCents: 150_000_00 }).rothCatchUpRequired).to.equal(false); // must EXCEED
    expect(run({}).rothCatchUpRequired).to.equal(null);
    // No catch-up dollars this period: nothing to designate.
    expect(compute401kDeferralCents(10_000, base, 0, opts).rothCatchUpRequired).to.equal(false);
  });

  it("rejects an out-of-range deferral election percentage", () => {
    expect(() => compute401kDeferralCents(100_000, { deferralElectionPct: 150 }, 0, Y2026)).to.throw(
      /between 0 and 100/
    );
  });
});

describe("runPayrollForEmployee (end-to-end for one employee, one pay period)", () => {
  it("produces gross pay, withholding, a 401(k) deferral, and a consistent net pay", () => {
    const employee = {
      id: "emp-001",
      payType: "salary",
      workState: "TX",
      annualSalaryCents: 104_000_00,
      payPeriodsPerYear: 26,
      deferralElectionPct: 5,
      w4: { formYear: 2026, filingStatus: "single" },
    };
    const payPeriod = { id: "2026-P01", taxYear: 2026 };
    // (workState "TX": no state income tax, so the hand-check below is federal + FICA)

    const result = runPayrollForEmployee(employee, payPeriod, 0);

    expect(result.employeeId).to.equal("emp-001");
    expect(result.payPeriodId).to.equal("2026-P01");
    expect(result.grossPayCents).to.equal(400_000); // $104,000 / 26 = $4,000.00

    const expectedDeferral = compute401kDeferralCents(result.grossPayCents, employee, 0, { taxYear: 2026 });
    expect(result.contribution401k).to.deep.equal(expectedDeferral);

    const expectedWithholding = computeTaxWithholdingCents({
      taxYear: 2026,
      grossPayCents: result.grossPayCents,
      preTaxDeductionsCents: expectedDeferral.actualCents,
      payPeriodsPerYear: 26,
      w4: employee.w4,
      workState: "TX",
    });
    expect(result.taxWithholding).to.deep.equal(expectedWithholding);

    // Hand-checked against Pub 15-T Worksheet 1A and Pub 15 (see above):
    // $4,000 - $496.38 federal - $248 SS - $58 Medicare - $0 state (TX) - $200 401(k)
    expect(result.netPayCents).to.equal(299_762);

    // Net pay must always equal gross minus withholding minus the 401(k) deferral -
    // this is the invariant that keeps payroll, taxes, and retirement contributions
    // all reconciling back to one consistent gross figure.
    expect(result.netPayCents).to.equal(
      result.grossPayCents - result.taxWithholding.totalCents - result.contribution401k.actualCents
    );
  });

  it("cuts a deferral back so net pay never goes below zero", () => {
    const employee = {
      id: "emp-all-in",
      payType: "salary",
      workState: "TX",
      annualSalaryCents: 104_000_00,
      payPeriodsPerYear: 26,
      deferralElectionPct: 100,
      w4: { formYear: 2026, filingStatus: "single" },
    };
    const result = runPayrollForEmployee(employee, { id: "2026-P01", taxYear: 2026 }, 0);
    expect(result.contribution401k.requestedCents).to.equal(400_000);
    expect(result.contribution401k.cappedByNetPay).to.equal(true);
    expect(result.netPayCents).to.be.at.least(0);
    expect(result.netPayCents).to.be.below(100); // as close to zero as cents allow
    // $4,000 - $248 SS - $58 Medicare - $0 state (TX), with federal at $0 at that deferral
    expect(result.contribution401k.actualCents).to.equal(369_400);
  });

  it("taxes Roth-required catch-up dollars as wages instead of excluding them", () => {
    const employee = {
      id: "emp-roth",
      payType: "salary",
      workState: "TX",
      annualSalaryCents: 520_000_00, // $20,000 a period
      payPeriodsPerYear: 26,
      deferralElectionPct: 40, // $8,000, all catch-up once at the base limit
      birthYear: 1970,
      priorYearFicaWagesCents: 300_000_00,
      w4: { formYear: 2026, filingStatus: "single" },
    };
    const result = runPayrollForEmployee(
      employee,
      { id: "2026-P20", taxYear: 2026 },
      24_500_00,
      { allowsCatchUp: true },
      400_000_00
    );
    expect(result.contribution401k.catchUpPortionCents).to.equal(800_000);
    expect(result.contribution401k.rothCatchUpRequired).to.equal(true);
    expect(result.taxWithholding.federalTaxableWagesCents).to.equal(2_000_000); // nothing excluded
  });

  it("stops Social Security at the wage base and starts Additional Medicare over $200,000", () => {
    const employee = {
      id: "emp-high",
      payType: "salary",
      workState: "TX",
      annualSalaryCents: 520_000_00,
      payPeriodsPerYear: 26,
      w4: { formYear: 2026, filingStatus: "single" },
    };
    // $190,000 already paid this year: past the $184,500 wage base, $10,000 under $200,000.
    const r = runPayrollForEmployee(employee, { id: "2026-P10", taxYear: 2026 }, 0, {}, 190_000_00);
    expect(r.taxWithholding.socialSecurityCents).to.equal(0);
    expect(r.taxWithholding.medicareCents).to.equal(29_000); // 1.45% x $20,000
    expect(r.taxWithholding.additionalMedicareCents).to.equal(9_000); // 0.9% x $10,000
  });

  it("flags an employee whose taxes alone would exceed gross pay", () => {
    const employee = {
      id: "emp-extra",
      payType: "salary",
      workState: "TX",
      annualSalaryCents: 26_000_00, // $1,000 a period
      payPeriodsPerYear: 26,
      w4: { formYear: 2026, filingStatus: "single", step4cExtraWithholdingCents: 2_000_00 },
    };
    expect(() => runPayrollForEmployee(employee, { id: "2026-P01", taxYear: 2026 }, 0)).to.throw(
      /exceed gross pay/
    );
  });
});

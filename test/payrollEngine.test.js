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
  PLACEHOLDER_CONFIG,
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
  it("applies the placeholder flat federal and state rates", () => {
    const result = computeTaxWithholdingCents(100_000); // $1,000.00 gross
    const expectedFederal = Math.round(100_000 * PLACEHOLDER_CONFIG.flatFederalWithholdingRate);
    const expectedState = Math.round(100_000 * PLACEHOLDER_CONFIG.flatStateWithholdingRate);
    expect(result.federalCents).to.equal(expectedFederal);
    expect(result.stateCents).to.equal(expectedState);
    expect(result.totalCents).to.equal(expectedFederal + expectedState);
  });
});

describe("compute401kDeferralCents", () => {
  it("defers the elected percentage of gross pay when there's room under the annual limit", () => {
    const employee = { deferralElectionPct: 10 };
    const result = compute401kDeferralCents(100_000, employee, 0); // $1,000 gross, 10%, $0 YTD
    expect(result.requestedCents).to.equal(10_000);
    expect(result.actualCents).to.equal(10_000);
    expect(result.cappedByAnnualLimit).to.equal(false);
  });

  it("caps the deferral at whatever room remains under the annual IRS limit", () => {
    const employee = { deferralElectionPct: 50 };
    const limit = PLACEHOLDER_CONFIG.annual401kElectiveDeferralLimitCents;
    const alreadyDeferredCents = limit - 5_000; // only $50.00 of room left
    const result = compute401kDeferralCents(100_000, employee, alreadyDeferredCents); // would request $500
    expect(result.requestedCents).to.equal(50_000);
    expect(result.actualCents).to.equal(5_000);
    expect(result.cappedByAnnualLimit).to.equal(true);
  });

  it("defers nothing once the annual limit is already fully used", () => {
    const employee = { deferralElectionPct: 10 };
    const limit = PLACEHOLDER_CONFIG.annual401kElectiveDeferralLimitCents;
    const result = compute401kDeferralCents(100_000, employee, limit);
    expect(result.actualCents).to.equal(0);
    expect(result.cappedByAnnualLimit).to.equal(true);
  });

  it("rejects an out-of-range deferral election percentage", () => {
    expect(() => compute401kDeferralCents(100_000, { deferralElectionPct: 150 }, 0)).to.throw(/between 0 and 100/);
  });
});

describe("runPayrollForEmployee (end-to-end for one employee, one pay period)", () => {
  it("produces gross pay, withholding, a 401(k) deferral, and a consistent net pay", () => {
    const employee = {
      id: "emp-001",
      payType: "salary",
      annualSalaryCents: 104_000_00,
      payPeriodsPerYear: 26,
      deferralElectionPct: 5,
    };
    const payPeriod = { id: "2026-P01" };

    const result = runPayrollForEmployee(employee, payPeriod, 0);

    expect(result.employeeId).to.equal("emp-001");
    expect(result.payPeriodId).to.equal("2026-P01");
    expect(result.grossPayCents).to.equal(400_000); // $104,000 / 26 = $4,000.00

    const expectedWithholding = computeTaxWithholdingCents(result.grossPayCents);
    expect(result.taxWithholding).to.deep.equal(expectedWithholding);

    const expectedDeferral = compute401kDeferralCents(result.grossPayCents, employee, 0);
    expect(result.contribution401k).to.deep.equal(expectedDeferral);

    // Net pay must always equal gross minus withholding minus the 401(k) deferral -
    // this is the invariant that keeps payroll, taxes, and retirement contributions
    // all reconciling back to one consistent gross figure.
    expect(result.netPayCents).to.equal(
      result.grossPayCents - result.taxWithholding.totalCents - result.contribution401k.actualCents
    );
  });
});

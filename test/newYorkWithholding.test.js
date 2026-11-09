// Plain-English overview: New York State, New York City and Yonkers
// withholding checked against all 24 worked examples in the NY Tax
// Department's 2026 booklets (NYS-50-T-NYS, -NYC, -Y). 21 match to the
// cent. The other 3 are within 1 cent, and in each the booklet's own worked
// text is inconsistent - this code follows the published table and normal
// rounding:
//   NYS single Ex. 2: $165.00 x 0.0753 = $12.4245, printed as $12.43
//                     (the booklet's Ex. 4 rounds $6.9024 down to $6.90).
//   NYS married Ex. 2: the text multiplies by "0.070" and prints $4.15;
//                     the table's rate on that line is 0.0707 ($4.16).
//   Yonkers single Ex. 3: $3,576.63 x 0.1675 = $599.0855, printed as $599.08
//                     (its Ex. 4 rounds $7.3868 up to $7.39).

const { expect } = require("chai");
const ny = require("../src/regulatory/state/ny");
const { computeTaxWithholdingCents } = require("../src/payroll/payrollEngine");
const { openPayrollStore } = require("../src/data/payrollStore");
const { runStoredPayroll } = require("../src/payroll/storedPayrollRun");

const PERIODS = { weekly: 52, semimonthly: 24, monthly: 12, daily: 260 };
const compute = (wagesCents, period, form, extra = {}) =>
  ny.compute({ taxYear: 2026, wagesCents, payPeriodsPerYear: PERIODS[period] ?? period, form, ...extra });

// [booklet, example, period, gross $, status, exemptions, booklet answer (cents), tolerance]
const EXAMPLES = [
  ["NYS", 1, "weekly", 400, "single", 3, 801, 0],
  ["NYS", 2, "semimonthly", 5000, "single", 1, 25851, 1],
  ["NYS", 3, "monthly", 50000, "single", 3, 357663, 0],
  ["NYS", 4, "daily", 750, "single", 2, 4410, 0],
  ["NYS", 1, "weekly", 400, "married", 4, 669, 0],
  ["NYS", 2, "semimonthly", 5000, "married", 3, 24811, 1],
  ["NYS", 3, "monthly", 50000, "married", 3, 362209, 0],
  ["NYS", 4, "daily", 750, "married", 2, 4458, 0],
  ["NYC", 1, "weekly", 400, "single", 3, 611, 0],
  ["NYC", 2, "semimonthly", 5000, "single", 1, 18880, 0],
  ["NYC", 3, "monthly", 50000, "single", 3, 207050, 0],
  ["NYC", 4, "daily", 750, "single", 2, 2951, 0],
  ["NYC", 1, "weekly", 400, "married", 4, 517, 0],
  ["NYC", 2, "semimonthly", 5000, "married", 3, 18437, 0],
  ["NYC", 3, "monthly", 50000, "married", 3, 206873, 0],
  ["NYC", 4, "daily", 750, "married", 2, 2943, 0],
  ["Yonkers", 1, "weekly", 400, "single", 3, 134, 0],
  ["Yonkers", 2, "semimonthly", 5000, "single", 1, 4330, 0],
  ["Yonkers", 3, "monthly", 50000, "single", 3, 59908, 1],
  ["Yonkers", 4, "daily", 750, "single", 2, 739, 0],
  ["Yonkers", 1, "weekly", 400, "married", 4, 112, 0],
  ["Yonkers", 2, "semimonthly", 5000, "married", 3, 4156, 0],
  ["Yonkers", 3, "monthly", 50000, "married", 3, 60670, 0],
  ["Yonkers", 4, "daily", 750, "married", 2, 747, 0],
];

describe("New York: the NY Tax Department's 24 worked examples (2026)", () => {
  for (const [booklet, n, period, gross, status, exemptions, answer, tolerance] of EXAMPLES) {
    it(`${booklet} ${status} Example ${n}: ${period} $${gross}, ${exemptions} exemptions -> $${(answer / 100).toFixed(2)}`, () => {
      const form = { filingStatus: status };
      if (booklet === "NYC") Object.assign(form, { nycResident: true, nycAllowances: exemptions });
      else Object.assign(form, { stateAllowances: exemptions, yonkersResident: booklet === "Yonkers" });
      const r = compute(gross * 100, period, form);
      const got = booklet === "NYS" ? r.stateCents : booklet === "NYC" ? r.localities.NYC : r.localities.YONKERS;
      expect(Math.abs(got - answer)).to.be.at.most(tolerance);
    });
  }
});

describe("New York: rules", () => {
  it("switches to Method III (top income rates) at $1,077,550 of annualized net wages", () => {
    // $30,000/week single, 0 allowances: net $29,857.70, annualized $1,552,600.40 x 10.45% / 52
    const r = compute(30_000_00, "weekly", { filingStatus: "single", stateAllowances: 0 });
    expect(r.lines.method).to.equal("III");
    expect(r.stateCents).to.equal(Math.round((155_260_040 * 1045) / 10_000 / 52));
    const below = compute(20_000_00, "weekly", { filingStatus: "single", stateAllowances: 0 });
    expect(below.lines.method).to.equal("II");
  });

  it("computes Yonkers as 16.75% of the State amount, using the State allowances", () => {
    const r = compute(2_000_00, "weekly", { filingStatus: "single", stateAllowances: 1, yonkersResident: true });
    expect(r.localities.YONKERS).to.equal(Math.round(r.stateCents * 0.1675));
  });

  it("withholds no city tax for a non-resident, and adds lines 3-5 to the right jurisdiction", () => {
    expect(compute(2_000_00, "weekly", { filingStatus: "single", stateAllowances: 1 }).localities).to.deep.equal({});
    const base = compute(2_000_00, "weekly", { filingStatus: "single", stateAllowances: 1, nycResident: true });
    const extra = compute(2_000_00, "weekly", {
      filingStatus: "single",
      stateAllowances: 1,
      nycResident: true,
      additionalStateCents: 10_00,
      additionalNycCents: 5_00,
    });
    expect(extra.stateCents).to.equal(base.stateCents + 10_00);
    expect(extra.localities.NYC).to.equal(base.localities.NYC + 5_00);
  });

  it("uses Single with zero allowances, and no city tax, when no IT-2104 is on file", () => {
    const r = compute(2_000_00, "weekly", null);
    expect(r.formBasis).to.equal("none-on-file-single-zero");
    expect(r.stateCents).to.equal(compute(2_000_00, "weekly", { filingStatus: "single", stateAllowances: 0 }).stateCents);
    expect(r.localities).to.deep.equal({});
  });

  it("falls back to a 2019-or-earlier federal W-4's allowances, as NYS-50 allows", () => {
    const federalW4 = { formYear: 2019, maritalStatus: "married", allowances: 2 };
    const r = compute(2_000_00, "weekly", null, { federalW4 });
    expect(r.formBasis).to.equal("none-on-file-used-pre-2020-w4");
    expect(r.stateCents).to.equal(compute(2_000_00, "weekly", { filingStatus: "married", stateAllowances: 2 }).stateCents);
    // A 2020+ federal W-4 has no allowances, so the zero default applies.
    expect(compute(2_000_00, "weekly", null, { federalW4: { formYear: 2026, filingStatus: "single" } }).formBasis).to.equal(
      "none-on-file-single-zero"
    );
  });

  it("treats 'married, but withhold at higher single rate' as single", () => {
    const a = compute(2_000_00, "weekly", { filingStatus: "marriedAtSingleRate", stateAllowances: 1 });
    const b = compute(2_000_00, "weekly", { filingStatus: "single", stateAllowances: 1 });
    expect(a.stateCents).to.equal(b.stateCents);
  });

  it("validates the IT-2104", () => {
    expect(() => compute(1, "weekly", { filingStatus: "head" })).to.throw(/IT-2104: filingStatus/);
    expect(() => compute(1, "weekly", { filingStatus: "single", nycResident: true, yonkersResident: true })).to.throw(
      /both New York City and Yonkers/
    );
    expect(() => compute(1, "weekly", { filingStatus: "single", nycAllowances: 2 })).to.throw(/non-resident/);
  });

  it("refuses a pay frequency the NY tables don't cover", () => {
    expect(() => compute(1_000_00, 4, null)).to.throw(/New York tables cover/);
  });
});

describe("New York in a payroll run", () => {
  const base = {
    taxYear: 2026,
    grossPayCents: 4_000_00,
    preTaxDeductionsCents: 200_00,
    payPeriodsPerYear: 26,
    w4: { formYear: 2026, filingStatus: "single" },
    workState: "NY",
  };

  it("withholds on federal income-tax wages and counts city tax in the total, kept separate", () => {
    const w = computeTaxWithholdingCents({
      ...base,
      stateW4: { filingStatus: "single", stateAllowances: 1, nycAllowances: 1, nycResident: true },
    });
    expect(w.stateWagesCents).to.equal(3_800_00);
    expect(w.localities.NYC).to.be.greaterThan(0);
    expect(w.localCents).to.equal(w.localities.NYC);
    expect(w.totalCents).to.equal(w.federalCents + w.ficaCents + w.stateCents + w.localCents);
  });

  it("saves city taxes by locality with the result", async () => {
    const store = openPayrollStore();
    try {
      store.upsertEmployee({
        id: "yk",
        payType: "salary",
        annualSalaryCents: 104_000_00,
        payPeriodsPerYear: 26,
        workState: "NY",
        stateW4: { filingStatus: "married", stateAllowances: 2, yonkersResident: true },
      });
      store.createPayPeriod({ id: "2026-P01", periodStart: "2025-12-22", periodEnd: "2026-01-04", payDate: "2026-01-09" });
      await runStoredPayroll(store, "2026-P01");
      const r = store.getResult("yk", "2026-P01");
      expect(r.outcome).to.equal("paid");
      expect(r.localWithholding.YONKERS).to.equal(Math.round(r.stateWithholdingCents * 0.1675));
    } finally {
      store.close();
    }
  });
});

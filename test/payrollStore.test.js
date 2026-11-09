// Plain-English overview: tests the payroll data layer (data/payrollStore.js)
// and running payroll from it (payroll/storedPayrollRun.js). Uses an
// in-memory SQLite database and a fake chain client, so no node or files
// are needed. The points proven here are the ones records exist for:
// year-to-date deferrals come from what was actually paid, nobody is paid
// twice for a period, and a missing timesheet is never treated as $0.

const { expect } = require("chai");
const { openPayrollStore } = require("../src/data/payrollStore");
const { runStoredPayroll, remittanceInstructionsForPeriod } = require("../src/payroll/storedPayrollRun");
const { toLedgerEmployeeId } = require("../src/chain/ledgerIds");

// Test-only key (32 bytes). Never a real deployment value.
const TEST_EMPLOYEE_ID_KEY = "11".repeat(32);

function makeFakeChainClient({ inactive = [] } = {}) {
  const recorded = [];
  return {
    recorded,
    async assertConsentActive(attestationId) {
      if (inactive.includes(attestationId)) throw new Error(`consent not active for ${attestationId}`);
      return true;
    },
    async recordContribution(employeeIdBytes32, payPeriodBytes32, amountCents, withheldAt) {
      const key = employeeIdBytes32 + payPeriodBytes32;
      if (recorded.some((r) => r.key === key)) throw new Error("contribution already recorded");
      recorded.push({ key, employeeIdBytes32, payPeriodBytes32, amountCents, withheldAt });
    },
  };
}

function seed(store) {
  store.upsertEmployee({
    id: "emp-001",
    payType: "salary",
    workState: "TX",
    annualSalaryCents: 104_000_00,
    payPeriodsPerYear: 26,
    deferralElectionPct: 5,
    consentAttestationId: "att-1",
  });
  store.upsertEmployee({
    id: "emp-002",
    payType: "hourly",
    workState: "TX",
    hourlyRateCents: 25_00,
    payPeriodsPerYear: 26,
    deferralElectionPct: 10,
    consentAttestationId: "att-2",
  });
  store.createPayPeriod({ id: "2026-P01", periodStart: "2025-12-22", periodEnd: "2026-01-04", payDate: "2026-01-09" });
  store.setHours("emp-002", "2026-P01", { regularHours: 80, overtimeHours: 4 });
}

describe("payrollStore: records", () => {
  let store;
  beforeEach(() => {
    store = openPayrollStore();
    seed(store);
  });
  afterEach(() => store.close());

  it("round-trips an employee and lists only active ones", () => {
    expect(store.getEmployee("emp-001")).to.include({ payType: "salary", annualSalaryCents: 104_000_00 });
    store.upsertEmployee({ ...store.getEmployee("emp-001"), status: "terminated" });
    expect(store.listActiveEmployees().map((e) => e.id)).to.deep.equal(["emp-002"]);
  });

  it("refuses a salaried employee without a salary, at the database level too", () => {
    expect(() => store.upsertEmployee({ id: "bad", payType: "salary" })).to.throw(/CHECK constraint/);
  });

  it("refuses a float or negative amount of cents", () => {
    expect(() =>
      store.upsertEmployee({ id: "x", payType: "hourly", hourlyRateCents: 25.5 })
    ).to.throw(/integer number of cents/);
    expect(() => store.setFicaWages("emp-001", 2025, -1)).to.throw(/integer number of cents/);
  });

  it("takes a pay period's tax year from its pay date (a period spanning New Year counts in the pay year)", () => {
    expect(store.getPayPeriod("2026-P01").taxYear).to.equal(2026);
  });

  it("rejects impossible dates and backwards periods", () => {
    expect(() =>
      store.createPayPeriod({ id: "p", periodStart: "2026-02-01", periodEnd: "2026-02-14", payDate: "2026-02-30" })
    ).to.throw(/not a real calendar date/);
    expect(() =>
      store.createPayPeriod({ id: "p", periodStart: "2026-02-14", periodEnd: "2026-02-01", payDate: "2026-02-20" })
    ).to.throw(/on or before/);
  });

  it("returns null, not zero, when no FICA wages are on file", () => {
    expect(store.getFicaWages("emp-001", 2025)).to.equal(null);
    store.setFicaWages("emp-001", 2025, 160_000_00);
    expect(store.getFicaWages("emp-001", 2025)).to.equal(160_000_00);
  });

  it("has no column for anything that identifies a person", () => {
    const columns = Object.values(store.describeSchema()).flat();
    expect(columns).to.include("birth_year"); // sanity: the listing works
    for (const forbidden of ["name", "ssn", "address", "email", "phone", "bank", "account", "dob", "birth_date"]) {
      expect(columns.filter((c) => c.includes(forbidden)), forbidden).to.deep.equal([]);
    }
  });

  it("round-trips a Form W-4, and stores none as null", () => {
    const w4 = { formYear: 2026, filingStatus: "marriedFilingJointly", step2Checkbox: true, step3CreditsCents: 4_000_00 };
    store.upsertEmployee({ ...store.getEmployee("emp-001"), w4 });
    expect(store.getEmployee("emp-001").w4).to.deep.equal(w4);
    expect(store.getEmployee("emp-002").w4).to.equal(null);
  });

  it("refuses an invalid W-4 before it reaches the database", () => {
    expect(() =>
      store.upsertEmployee({ ...store.getEmployee("emp-001"), w4: { formYear: 2026, filingStatus: "married" } })
    ).to.throw(/Form W-4: filingStatus/);
  });

  it("round-trips a work state and its state certificate", () => {
    const de4 = { filingStatus: "married", regularAllowances: 2 };
    store.upsertEmployee({ ...store.getEmployee("emp-001"), workState: "CA", stateW4: de4 });
    expect(store.getEmployee("emp-001")).to.deep.include({ workState: "CA", stateW4: de4 });
  });

  it("refuses a state certificate that doesn't fit the work state, or an unsupported state", () => {
    const emp = store.getEmployee("emp-001");
    expect(() => store.upsertEmployee({ ...emp, workState: "CA", stateW4: { line1Allowances: 1 } })).to.throw(
      /California DE 4/
    );
    expect(() => store.upsertEmployee({ ...emp, workState: "PR" })).to.throw(/no sourced withholding method/);
    expect(() => store.upsertEmployee({ ...emp, workState: null, stateW4: { line1Allowances: 1 } })).to.throw(
      /without a workState/
    );
  });

  it("refuses to open a database file from an older schema version", () => {
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const { DatabaseSync } = require("node:sqlite");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "newco-payroll-"));
    const file = path.join(dir, "old.db");
    try {
      const old = new DatabaseSync(file);
      old.exec("CREATE TABLE employees (id TEXT PRIMARY KEY)"); // a v1-era file: user_version 0
      old.close();
      expect(() => openPayrollStore(file)).to.throw(/schema version 0, this code needs 4/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("runStoredPayroll", () => {
  let store;
  beforeEach(() => {
    store = openPayrollStore();
    seed(store);
  });
  afterEach(() => store.close());

  it("pays each hourly employee for their own timesheet", async () => {
    await runStoredPayroll(store, "2026-P01");
    // 80h * $25 + 4h * $25 * 1.5 = $2,000 + $150
    expect(store.getResult("emp-002", "2026-P01").grossPayCents).to.equal(215_000);
    expect(store.getResult("emp-001", "2026-P01").grossPayCents).to.equal(400_000);
  });

  it("flags an hourly employee with no timesheet instead of paying $0", async () => {
    store.createPayPeriod({ id: "2026-P02", periodStart: "2026-01-05", periodEnd: "2026-01-18", payDate: "2026-01-23" });
    const { outcomes } = await runStoredPayroll(store, "2026-P02");
    const r = store.getResult("emp-002", "2026-P02");
    expect(r.outcome).to.equal("error");
    expect(r.reason).to.match(/no timesheet/);
    expect(r.grossPayCents).to.equal(null);
    expect(outcomes).to.have.length(2);
  });

  it("never pays an employee twice for the same period, and retries only the ones that weren't paid", async () => {
    const chainClient = makeFakeChainClient({ inactive: ["att-2"] });
    const opts = { chainClient, employeeIdKey: TEST_EMPLOYEE_ID_KEY };

    await runStoredPayroll(store, "2026-P01", opts);
    expect(store.getResult("emp-001", "2026-P01").outcome).to.equal("paid");
    expect(store.getResult("emp-002", "2026-P01").outcome).to.equal("error"); // consent not active

    // Consent fixed; run the period again.
    const retryClient = makeFakeChainClient();
    retryClient.recorded.push(...chainClient.recorded); // the ledger remembers the first run
    const second = await runStoredPayroll(store, "2026-P01", { ...opts, chainClient: retryClient });

    expect(second.alreadyPaid).to.deep.equal(["emp-001"]);
    expect(store.getResult("emp-002", "2026-P01").outcome).to.equal("paid");
    expect(retryClient.recorded).to.have.length(2); // one write per employee in total
  });

  it("refuses to overwrite a paid result even if asked directly", () => {
    const pp = store.getPayPeriod("2026-P01");
    const employee = store.getEmployee("emp-001");
    const paid = {
      employee,
      result: {
        grossPayCents: 1,
        taxWithholding: { federalCents: 0, stateCents: 0 },
        contribution401k: { requestedCents: 0, actualCents: 0, catchUpPortionCents: 0, rothCatchUpRequired: false },
        netPayCents: 1,
      },
    };
    store.saveOutcomes(pp, [paid]);
    expect(() => store.saveOutcomes(pp, [{ employee, error: "x" }])).to.throw(/already paid/);
    expect(store.getResult("emp-001", "2026-P01").outcome).to.equal("paid");
  });

  it("caps deferrals using year-to-date totals from saved results, not a caller's number", async () => {
    store.upsertEmployee({
      id: "emp-003",
      payType: "salary",
      workState: "TX",
      annualSalaryCents: 1_300_000_00, // $50,000 a period
      payPeriodsPerYear: 26,
      deferralElectionPct: 30, // $15,000 a period
    });
    const periods = [
      ["2026-P01", "2026-01-09"],
      ["2026-P02", "2026-01-23"],
    ];
    store.createPayPeriod({ id: "2026-P02", periodStart: "2026-01-05", periodEnd: "2026-01-18", payDate: "2026-01-23" });
    store.setHours("emp-002", "2026-P02", { regularHours: 80 });
    for (const [id] of periods) await runStoredPayroll(store, id);

    expect(store.getResult("emp-003", "2026-P01").deferralCents).to.equal(15_000_00);
    expect(store.getResult("emp-003", "2026-P02").deferralCents).to.equal(9_500_00); // $24,500 - $15,000
    expect(store.yearToDateDeferralCents("emp-003", 2026)).to.equal(24_500_00);
  });

  it("starts the year-to-date total over in a new tax year", async () => {
    store.createPayPeriod({ id: "2025-P26", periodStart: "2025-12-08", periodEnd: "2025-12-21", payDate: "2025-12-26" });
    store.setHours("emp-002", "2025-P26", { regularHours: 80 });
    await runStoredPayroll(store, "2025-P26");
    await runStoredPayroll(store, "2026-P01");
    expect(store.yearToDateDeferralCents("emp-001", 2025)).to.equal(20_000);
    expect(store.yearToDateDeferralCents("emp-001", 2026)).to.equal(20_000);
  });

  it("uses last year's FICA wages from the store for the Roth catch-up rule", async () => {
    store.upsertEmployee({
      id: "emp-004",
      payType: "salary",
      workState: "TX",
      annualSalaryCents: 520_000_00, // $20,000 a period
      payPeriodsPerYear: 26,
      deferralElectionPct: 40, // $8,000 requested
      birthYear: 1970,
    });
    store.setFicaWages("emp-004", 2025, 200_000_00);
    // Put emp-004 right at the base limit so this period is all catch-up.
    store.createPayPeriod({ id: "2026-P00", periodStart: "2025-12-01", periodEnd: "2025-12-14", payDate: "2026-01-02" });
    store.saveOutcomes(store.getPayPeriod("2026-P00"), [
      {
        employee: store.getEmployee("emp-004"),
        result: {
          grossPayCents: 24_500_00,
          taxWithholding: { federalCents: 0, stateCents: 0 },
          contribution401k: { requestedCents: 24_500_00, actualCents: 24_500_00, catchUpPortionCents: 0, rothCatchUpRequired: false },
          netPayCents: 0,
        },
      },
    ]);

    await runStoredPayroll(store, "2026-P01", { plan: { allowsCatchUp: true } });
    const r = store.getResult("emp-004", "2026-P01");
    expect(r.catchUpPortionCents).to.equal(8_000_00); // capped at the 2026 catch-up limit
    expect(r.rothCatchUpRequired).to.equal(true); // $200,000 > $150,000
  });

  it("rebuilds the remittance file from saved results, with keyed ledger IDs only", async () => {
    const chainClient = makeFakeChainClient();
    await runStoredPayroll(store, "2026-P01", { chainClient, employeeIdKey: TEST_EMPLOYEE_ID_KEY });

    const lines = remittanceInstructionsForPeriod(store, "2026-P01");
    expect(lines).to.have.length(2);
    const first = lines.find((l) => l.ledgerEmployeeId === toLedgerEmployeeId("emp-001", TEST_EMPLOYEE_ID_KEY));
    expect(first.amountCents).to.equal(20_000);
    expect(JSON.stringify(lines)).to.not.include("emp-00");
  });

  it("has no remittance lines for a run that never touched the chain", async () => {
    await runStoredPayroll(store, "2026-P01");
    expect(remittanceInstructionsForPeriod(store, "2026-P01")).to.deep.equal([]);
  });

  it("refuses to change hours after the employee was paid for the period", async () => {
    await runStoredPayroll(store, "2026-P01");
    expect(() => store.setHours("emp-002", "2026-P01", { regularHours: 90 })).to.throw(/already paid/);
  });

  it("saves federal, Social Security and Medicare separately, using the employee's W-4", async () => {
    store.upsertEmployee({ ...store.getEmployee("emp-001"), w4: { formYear: 2026, filingStatus: "single" } });
    await runStoredPayroll(store, "2026-P01");
    const r = store.getResult("emp-001", "2026-P01");
    expect(r.federalWithholdingCents).to.equal(49_638); // hand-checked in payrollEngine.test.js
    expect(r.socialSecurityCents).to.equal(24_800);
    expect(r.medicareCents).to.equal(5_800);
    expect(r.additionalMedicareCents).to.equal(0);
  });

  it("feeds year-to-date FICA wages from saved results, so Social Security stops at the wage base", async () => {
    store.upsertEmployee({
      id: "emp-005",
      payType: "salary",
      workState: "TX",
      annualSalaryCents: 2_600_000_00, // $100,000 a period
      payPeriodsPerYear: 26,
    });
    store.createPayPeriod({ id: "2026-P02", periodStart: "2026-01-05", periodEnd: "2026-01-18", payDate: "2026-01-23" });
    store.createPayPeriod({ id: "2026-P03", periodStart: "2026-01-19", periodEnd: "2026-02-01", payDate: "2026-02-06" });
    for (const id of ["2026-P02", "2026-P03"]) store.setHours("emp-002", id, { regularHours: 80 });
    for (const id of ["2026-P01", "2026-P02", "2026-P03"]) await runStoredPayroll(store, id);

    const ss = ["2026-P01", "2026-P02", "2026-P03"].map((id) => store.getResult("emp-005", id).socialSecurityCents);
    // $100,000 + $84,500 of the $184,500 wage base, then nothing.
    expect(ss).to.deep.equal([6_200_00, 5_239_00, 0]);
    expect(store.yearToDateFicaWagesCents("emp-005", 2026)).to.equal(300_000_00);
    // $200,000 paid before the 3rd check, so all of its $100,000 is over the
    // Additional Medicare threshold: 0.9% x $100,000.
    expect(store.getResult("emp-005", "2026-P02").additionalMedicareCents).to.equal(0);
    expect(store.getResult("emp-005", "2026-P03").additionalMedicareCents).to.equal(900_00);
  });

  it("persists to a file and reopens with the same records", async () => {
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "newco-payroll-"));
    const file = path.join(dir, "payroll.db");
    try {
      const a = openPayrollStore(file);
      seed(a);
      await runStoredPayroll(a, "2026-P01");
      a.close();
      const b = openPayrollStore(file);
      expect(b.yearToDateDeferralCents("emp-001", 2026)).to.equal(20_000);
      b.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("runStoredPayroll: state withholding from the employee record", () => {
  it("withholds by each employee's own work state and certificate", async () => {
    const store = openPayrollStore();
    try {
      const base = { payType: "salary", annualSalaryCents: 104_000_00, payPeriodsPerYear: 26 };
      store.upsertEmployee({ ...base, id: "ca", workState: "CA", stateW4: { filingStatus: "single", regularAllowances: 1 } });
      store.upsertEmployee({ ...base, id: "il", workState: "IL", stateW4: { line1Allowances: 1, line2Allowances: 0 } });
      store.upsertEmployee({ ...base, id: "pa", workState: "PA" });
      store.upsertEmployee({ ...base, id: "tx", workState: "TX" });
      store.upsertEmployee({ ...base, id: "none" }); // no work state on file
      store.createPayPeriod({ id: "2026-P01", periodStart: "2025-12-22", periodEnd: "2026-01-04", payDate: "2026-01-09" });
      await runStoredPayroll(store, "2026-P01");

      const st = (id) => store.getResult(id, "2026-P01");
      expect(st("pa").stateWithholdingCents).to.equal(122_80); // 3.07% x $4,000
      expect(st("tx").stateWithholdingCents).to.equal(0);
      // IL: 4.95% x ($4,000 - $2,925/26)
      expect(st("il").stateWithholdingCents).to.equal(Math.round((4_000_00 - 2_925_00 / 26) * 0.0495));
      expect(st("ca").stateWithholdingCents).to.be.greaterThan(0);
      // Missing work state fails that employee for review, not the batch.
      expect(st("none").outcome).to.equal("error");
      expect(st("none").reason).to.match(/no work state on file/);
    } finally {
      store.close();
    }
  });
});

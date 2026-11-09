// Plain-English overview: tests the orchestration logic in payrollRun.js
// using a FAKE chain client (plain JS object, no real blockchain), so we
// can prove the consent-gating and per-employee error isolation rules
// without needing a running node. The actual chain-calling code in
// chain/contracts.js is exercised separately once a real or local test
// network is wired up - that's intentionally out of scope for this
// scaffold increment.

const { expect } = require("chai");
const { runPayrollBatch } = require("../src/payroll/payrollRun");
// Test-only key (32 bytes). Never a real deployment value.
const TEST_EMPLOYEE_ID_KEY = "11".repeat(32);

function makeFakeChainClient({ consentActiveByAttestation = {} } = {}) {
  const recordedContributions = [];
  return {
    recordedContributions,
    async assertConsentActive(attestationId) {
      if (!consentActiveByAttestation[attestationId]) {
        throw new Error(`consent not active for attestation ${attestationId}; refusing to proceed`);
      }
      return true;
    },
    async recordContribution(employeeIdBytes32, payPeriodBytes32, amountCents, withheldAt) {
      recordedContributions.push({ employeeIdBytes32, payPeriodBytes32, amountCents, withheldAt });
      return { transactionHash: "0xFAKE" };
    },
  };
}

const salariedEmployee = (id, deferralElectionPct = 5) => ({
  id,
  payType: "salary",
  annualSalaryCents: 104_000_00,
  payPeriodsPerYear: 26,
  deferralElectionPct,
});

describe("runPayrollBatch (no chain client - dry run)", () => {
  it("computes payroll for every employee without needing consent or a chain at all", async () => {
    const employees = [salariedEmployee("emp-001"), salariedEmployee("emp-002")];
    const payPeriod = { id: "2026-P01" };

    const outcomes = await runPayrollBatch(employees, payPeriod, {});

    expect(outcomes).to.have.length(2);
    for (const outcome of outcomes) {
      expect(outcome.skipped).to.be.undefined;
      expect(outcome.error).to.be.undefined;
      expect(outcome.result.grossPayCents).to.equal(400_000);
    }
  });
});

describe("runPayrollBatch (with a chain client)", () => {
  it("skips an employee with no consent attestation on file, rather than proceeding anyway", async () => {
    const employees = [salariedEmployee("emp-001")];
    const payPeriod = { id: "2026-P01" };
    const chainClient = makeFakeChainClient({});

    const outcomes = await runPayrollBatch(employees, payPeriod, {
      chainClient,
      employeeIdKey: TEST_EMPLOYEE_ID_KEY,
      consentAttestationFor: () => null,
    });

    expect(outcomes[0].skipped).to.equal(true);
    expect(outcomes[0].skipReason).to.match(/no active consent/);
    expect(chainClient.recordedContributions).to.have.length(0);
  });

  it("hard-stops an employee whose consent attestation exists but is not active", async () => {
    const employees = [salariedEmployee("emp-001")];
    const payPeriod = { id: "2026-P01" };
    const chainClient = makeFakeChainClient({ consentActiveByAttestation: { "attn-1": false } });

    const outcomes = await runPayrollBatch(employees, payPeriod, {
      chainClient,
      employeeIdKey: TEST_EMPLOYEE_ID_KEY,
      consentAttestationFor: () => "attn-1",
    });

    expect(outcomes[0].error).to.match(/consent not active/);
    expect(chainClient.recordedContributions).to.have.length(0);
  });

  it("records a contribution to the ledger when consent is active", async () => {
    const employees = [salariedEmployee("emp-001")];
    const payPeriod = { id: "2026-P01" };
    const chainClient = makeFakeChainClient({ consentActiveByAttestation: { "attn-1": true } });

    const outcomes = await runPayrollBatch(employees, payPeriod, {
      chainClient,
      employeeIdKey: TEST_EMPLOYEE_ID_KEY,
      consentAttestationFor: () => "attn-1",
    });

    expect(outcomes[0].result).to.exist;
    expect(chainClient.recordedContributions).to.have.length(1);
    expect(chainClient.recordedContributions[0].amountCents).to.equal(
      outcomes[0].result.contribution401k.actualCents
    );
  });

  it("isolates one employee's failure from the rest of the batch", async () => {
    const employees = [salariedEmployee("emp-broken"), salariedEmployee("emp-ok")];
    const payPeriod = { id: "2026-P01" };
    const chainClient = makeFakeChainClient({
      consentActiveByAttestation: { "attn-broken": false, "attn-ok": true },
    });

    const outcomes = await runPayrollBatch(employees, payPeriod, {
      chainClient,
      employeeIdKey: TEST_EMPLOYEE_ID_KEY,
      consentAttestationFor: (employee) => (employee.id === "emp-broken" ? "attn-broken" : "attn-ok"),
    });

    expect(outcomes[0].error).to.match(/consent not active/);
    expect(outcomes[1].result).to.exist;
    expect(chainClient.recordedContributions).to.have.length(1);
  });
});

describe("runPayrollBatch (on-chain employee IDs)", () => {
  const { ethers } = require("ethers");
  const { toLedgerEmployeeId } = require("../src/chain/ledgerIds");

  it("records the keyed ledger ID, never a plain hash of the employee ID", async () => {
    const chainClient = makeFakeChainClient({ consentActiveByAttestation: { "attn-1": true } });

    await runPayrollBatch([salariedEmployee("emp-001")], { id: "2026-P01" }, {
      chainClient,
      employeeIdKey: TEST_EMPLOYEE_ID_KEY,
      consentAttestationFor: () => "attn-1",
    });

    const recorded = chainClient.recordedContributions[0].employeeIdBytes32;
    expect(recorded).to.equal(toLedgerEmployeeId("emp-001", TEST_EMPLOYEE_ID_KEY));
    expect(recorded).to.not.equal(ethers.keccak256(ethers.toUtf8Bytes("emp-001")));
  });

  it("refuses the whole batch up front when a chain client is set but the key is missing", async () => {
    const chainClient = makeFakeChainClient({ consentActiveByAttestation: { "attn-1": true } });
    let error;
    try {
      await runPayrollBatch([salariedEmployee("emp-001")], { id: "2026-P01" }, {
        chainClient,
        consentAttestationFor: () => "attn-1",
      });
    } catch (err) {
      error = err;
    }
    expect(error).to.exist;
    expect(error.message).to.match(/NEWCO_EMPLOYEE_ID_KEY/);
    expect(chainClient.recordedContributions).to.have.length(0);
  });

  it("refuses a key that is too short rather than writing weak IDs", async () => {
    const chainClient = makeFakeChainClient({ consentActiveByAttestation: { "attn-1": true } });
    let error;
    try {
      await runPayrollBatch([salariedEmployee("emp-001")], { id: "2026-P01" }, {
        chainClient,
        employeeIdKey: "ab".repeat(16),
        consentAttestationFor: () => "attn-1",
      });
    } catch (err) {
      error = err;
    }
    expect(error && error.message).to.match(/at least 32 bytes/);
    expect(chainClient.recordedContributions).to.have.length(0);
  });

  it("does not need a key for a dry run with no chain client", async () => {
    const outcomes = await runPayrollBatch([salariedEmployee("emp-001")], { id: "2026-P01" }, {});
    expect(outcomes[0].result).to.exist;
  });
});

describe("runPayrollBatch (ledger entries for remittance instructions)", () => {
  const { toLedgerEmployeeId } = require("../src/chain/ledgerIds");
  const { toBytes32Id } = require("../src/chain/contracts");

  it("returns the ledger entry it wrote, using the keyed employee ID", async () => {
    const chainClient = makeFakeChainClient({ consentActiveByAttestation: { "attn-1": true } });
    const [outcome] = await runPayrollBatch([salariedEmployee("emp-001")], { id: "2026-P01" }, {
      chainClient,
      employeeIdKey: TEST_EMPLOYEE_ID_KEY,
      consentAttestationFor: () => "attn-1",
    });
    const written = chainClient.recordedContributions[0];
    expect(outcome.ledgerEntry).to.deep.equal({
      ledgerEmployeeId: toLedgerEmployeeId("emp-001", TEST_EMPLOYEE_ID_KEY),
      ledgerPayPeriodId: toBytes32Id("2026-P01"),
      amountCents: written.amountCents,
      withheldAt: written.withheldAt,
    });
  });

  it("has no ledger entry for a dry run or a skipped employee", async () => {
    const [dry] = await runPayrollBatch([salariedEmployee("emp-001")], { id: "2026-P01" }, {});
    expect(dry.ledgerEntry).to.be.undefined;

    const chainClient = makeFakeChainClient({});
    const [skipped] = await runPayrollBatch([salariedEmployee("emp-001")], { id: "2026-P01" }, {
      chainClient,
      employeeIdKey: TEST_EMPLOYEE_ID_KEY,
      consentAttestationFor: () => null,
    });
    expect(skipped.skipped).to.equal(true);
    expect(skipped.ledgerEntry).to.be.undefined;
  });
});

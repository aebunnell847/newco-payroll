// Plain-English overview: unlike payrollRun.test.js (which uses a
// hand-written fake chain client), this test talks to REAL deployed
// contracts on a real local blockchain node. It proves the full path:
// payroll math -> consent check against a real ConsentRegistry -> a real
// recordContribution call against a real ReconciliationLedger -> reading
// the result back from the chain.
//
// It needs a local Hardhat node running at http://127.0.0.1:8545 (start
// one from the sibling newco-contracts repo with `npx hardhat node`). If
// no node is reachable, this suite skips itself with a clear message
// rather than failing the whole test run - the unit tests in
// payrollEngine.test.js and payrollRun.test.js never need a chain at all.

const { expect } = require("chai");
const { ethers } = require("ethers");
const { createChainClient, toBytes32Id, CONSENT_REGISTRY_ABI, RECONCILIATION_LEDGER_ABI } = require("../src/chain/contracts");
const { runPayrollBatch } = require("../src/payroll/payrollRun");

const consentArtifact = require("../src/chain/abi/ConsentRegistry.json");
const ledgerArtifact = require("../src/chain/abi/ReconciliationLedger.json");

const RPC_URL = "http://127.0.0.1:8545";

// The well-known local Hardhat/Ganache default test-mnemonic keys -
// public, meant only for a disposable local network. See the identical
// note in newco-contracts/test/*.test.js.
const PAYROLL_SIGNER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // account #0
const CUSTODIAN_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // account #1
const EMPLOYEE_WALLET_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"; // account #2

// A plain JSON-RPC probe with a hard timeout, deliberately NOT an ethers
// JsonRpcProvider: with no node running, a provider retries network
// detection every second forever, which kept the mocha process alive
// after the suite had already skipped - `npm test` hung instead of
// exiting. fetch + AbortSignal leaves nothing running behind it.
async function isNodeReachable() {
  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_chainId", params: [], id: 1 }),
      signal: AbortSignal.timeout(2000),
    });
    const body = await res.json();
    return typeof body.result === "string";
  } catch (err) {
    return false;
  }
}

describe("integration: real deployed contracts on a local chain", function () {
  this.timeout(30000);

  let provider, payrollDeployer, custodianWallet, employeeWallet;
  let consentRegistry, reconciliationLedger;
  let chainClient;
  let nodeAvailable;

  before(async function () {
    nodeAvailable = await isNodeReachable();
    if (!nodeAvailable) {
      console.log(
        "\n  (skipping integration suite: no local chain reachable at " +
          RPC_URL +
          " - start one with `npx hardhat node` in newco-contracts)\n"
      );
      this.skip();
    }

    provider = new ethers.JsonRpcProvider(RPC_URL, undefined, { cacheTimeout: -1 });
    payrollDeployer = new ethers.Wallet(PAYROLL_SIGNER_KEY, provider);
    custodianWallet = new ethers.Wallet(CUSTODIAN_KEY, provider);
    employeeWallet = new ethers.Wallet(EMPLOYEE_WALLET_KEY, provider);

    const consentFactory = new ethers.ContractFactory(consentArtifact.abi, consentArtifact.bytecode, employeeWallet);
    consentRegistry = await consentFactory.deploy();
    await consentRegistry.waitForDeployment();

    const ledgerFactory = new ethers.ContractFactory(ledgerArtifact.abi, ledgerArtifact.bytecode, payrollDeployer);
    reconciliationLedger = await ledgerFactory.deploy(payrollDeployer.address, custodianWallet.address);
    await reconciliationLedger.waitForDeployment();

    chainClient = createChainClient({
      rpcUrl: RPC_URL,
      payrollSignerPrivateKey: PAYROLL_SIGNER_KEY,
      consentRegistryAddress: await consentRegistry.getAddress(),
      reconciliationLedgerAddress: await reconciliationLedger.getAddress(),
    });
  });

  it("refuses to record a contribution when the employee has not granted an active consent attestation", async function () {
    const fakeAttestationId = ethers.keccak256(ethers.toUtf8Bytes("never-granted"));
    let threw = false;
    try {
      await chainClient.assertConsentActive(fakeAttestationId);
    } catch (err) {
      threw = true;
      expect(err.message).to.match(/consent not active/);
    }
    expect(threw).to.equal(true);
  });

  it("runs a real payroll batch end-to-end once the employee grants consent on-chain", async function () {
    // The EMPLOYEE's own wallet grants access - not payroll, not NewCo.
    // This is Tenet 1 exercised for real, against a real contract.
    const dataCategory = ethers.keccak256(ethers.toUtf8Bytes("PAYROLL_PROCESSING"));
    const block = await provider.getBlock("latest");
    const expiry = block.timestamp + 3600;

    const grantTx = await consentRegistry.connect(employeeWallet).grantAccess(payrollDeployer.address, dataCategory, expiry);
    const grantReceipt = await grantTx.wait();
    const { attestationId } = grantReceipt.logs
      .map((l) => consentRegistry.interface.parseLog(l))
      .find((e) => e.name === "AccessGranted").args;

    const employee = {
      id: "emp-integration-001",
      payType: "salary",
      annualSalaryCents: 130_000_00,
      payPeriodsPerYear: 26,
      deferralElectionPct: 6,
    };
    const payPeriod = { id: "2026-P-integration" };

    const outcomes = await runPayrollBatch([employee], payPeriod, {
      chainClient,
      consentAttestationFor: () => attestationId,
      yearToDateDeferralFor: () => 0,
    });

    expect(outcomes).to.have.length(1);
    expect(outcomes[0].error).to.be.undefined;
    expect(outcomes[0].skipped).to.be.undefined;
    expect(outcomes[0].result.grossPayCents).to.equal(500_000); // $130,000 / 26

    // Read the result back from the REAL ReconciliationLedger, not from
    // anything cached in memory - this is the actual proof the write landed.
    const employeeIdBytes32 = toBytes32Id(employee.id);
    const payPeriodBytes32 = toBytes32Id(payPeriod.id);
    const status = await chainClient.getReconciliationStatus(employeeIdBytes32, payPeriodBytes32);
    expect(status).to.equal(1n); // ContributionOnly - no remittance recorded yet, which is correct

    const storedContribution = await reconciliationLedger.contributions(
      ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [employeeIdBytes32, payPeriodBytes32])
    );
    expect(storedContribution.amountCents).to.equal(BigInt(outcomes[0].result.contribution401k.actualCents));
  });

  it("reaches Matched status once the custodian also records a matching remittance on-chain", async function () {
    const employeeIdBytes32 = toBytes32Id("emp-integration-001");
    const payPeriodBytes32 = toBytes32Id("2026-P-integration");

    const stored = await reconciliationLedger.contributions(
      ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [employeeIdBytes32, payPeriodBytes32])
    );

    const remittedAt = Number(stored.withheldAt) + 60 * 60 * 24; // 1 day later, well within the 7-day window
    const tx = await reconciliationLedger
      .connect(custodianWallet)
      .recordRemittance(employeeIdBytes32, payPeriodBytes32, stored.amountCents, remittedAt);
    await tx.wait();

    const status = await chainClient.getReconciliationStatus(employeeIdBytes32, payPeriodBytes32);
    expect(status).to.equal(3n); // Matched
  });
});

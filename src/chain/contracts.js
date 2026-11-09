// Plain-English overview: this is the ONLY file in this service that's
// supposed to know how to talk to the blockchain. Keeping all the
// ethers.js/contract-calling code in one place means everything else
// (the payroll math, the orchestration logic) can be tested without ever
// touching a real or simulated chain.
//
// It is a thin wrapper around two contracts already built and tested in
// the sibling `newco-contracts` repo:
//   - ConsentRegistry: used BEFORE we touch any employee data, to check
//     the employee's own wallet has actively granted this use ("Tenet 1").
//   - ReconciliationLedger: used AFTER payroll runs, to record what was
//     withheld (recordContribution) and later what was remitted to the
//     custodian (recordRemittance). Per "Tenet 2" and the one hard
//     guardrail everywhere else in this project: this code only ever
//     RECORDS and FLAGS discrepancies. It must never silently block or
//     "fix" a remittance - a human/ministerial process does that.
//
// The ABIs below are loaded from the REAL compiled artifacts, vendored in
// from the sibling `newco-contracts` repo (src/chain/abi/*.json - copied
// from newco-contracts/artifacts-custom/ after running its compile.js).
// This means this file always reflects the actual deployed contract
// interface rather than a hand-copied signature list that could drift.
// TODO once these components live in a shared workspace/monorepo or
// newco-contracts is published as a package: replace this copy step with
// a real dependency so the two can never go out of sync silently.

const { ethers } = require("ethers");
const consentRegistryArtifact = require("./abi/ConsentRegistry.json");
const reconciliationLedgerArtifact = require("./abi/ReconciliationLedger.json");

const CONSENT_REGISTRY_ABI = consentRegistryArtifact.abi;
const RECONCILIATION_LEDGER_ABI = reconciliationLedgerArtifact.abi;

/**
 * createChainClient
 * -------------------
 * config shape:
 *   {
 *     rpcUrl: "http://127.0.0.1:8545",       // or a real network RPC endpoint
 *     payrollSignerPrivateKey: "0x...",       // the key this service signs as
 *     consentRegistryAddress: "0x...",
 *     reconciliationLedgerAddress: "0x...",
 *   }
 * Nothing here is called at module load time - the caller decides when
 * (and whether) to actually connect, which keeps this file importable and
 * inspectable even with no chain running, e.g. during unit tests of other
 * modules that depend on this one only by interface.
 */
function createChainClient(config) {
  // cacheTimeout: -1 disables ethers v6's brief read-cache (eth_getTransactionCount
  // etc.), which otherwise causes spurious "nonce too low" errors when this
  // service sends several transactions back-to-back against a fast,
  // auto-mining local node. Learned the hard way in newco-contracts' tests.
  const provider = new ethers.JsonRpcProvider(config.rpcUrl, undefined, { cacheTimeout: -1 });
  // signerPrivateKey lets the same wrapper act as the custodian (which
  // records remittances); payrollSignerPrivateKey is kept for existing
  // payroll callers.
  const signer = new ethers.Wallet(config.signerPrivateKey || config.payrollSignerPrivateKey, provider);

  const consentRegistry = new ethers.Contract(
    config.consentRegistryAddress,
    CONSENT_REGISTRY_ABI,
    signer
  );

  const reconciliationLedger = new ethers.Contract(
    config.reconciliationLedgerAddress,
    RECONCILIATION_LEDGER_ABI,
    signer
  );

  /**
   * assertConsentActive
   * ---------------------
   * Checks the employee's own wallet-granted attestation is still active
   * BEFORE this service reads or uses any gated employee data. Throws if
   * it is not - this is the one place "no active consent" should hard-stop
   * the flow, as opposed to the reconciliation guardrail which never
   * hard-stops anything.
   */
  async function assertConsentActive(attestationId) {
    const active = await consentRegistry.isAccessActive(attestationId);
    if (!active) {
      throw new Error(`consent not active for attestation ${attestationId}; refusing to proceed`);
    }
    return true;
  }

  /**
   * recordContribution
   * ---------------------
   * Writes "payroll withheld this amount, at this time, for this employee
   * and pay period" to the ledger. employeeId and payPeriod should be
   * bytes32 values (e.g. keccak256 hashes of stable string identifiers),
   * consistent with how the contract's tests construct them.
   */
  async function recordContribution(employeeId, payPeriod, amountCents, withheldAt) {
    const tx = await reconciliationLedger.recordContribution(employeeId, payPeriod, amountCents, withheldAt);
    return tx.wait();
  }

  /**
   * recordRemittance
   * -------------------
   * Writes "custodian confirms this amount arrived, at this time" to the
   * ledger. In production this is called from the custodian-side
   * integration, not from payroll - included here so this one wrapper
   * module covers the whole contract interface during this scaffold stage.
   */
  async function recordRemittance(employeeId, payPeriod, amountCents, remittedAt) {
    const tx = await reconciliationLedger.recordRemittance(employeeId, payPeriod, amountCents, remittedAt);
    return tx.wait();
  }

  async function getReconciliationStatus(employeeId, payPeriod) {
    return reconciliationLedger.status(employeeId, payPeriod);
  }

  return {
    provider,
    signer,
    consentRegistry,
    reconciliationLedger,
    assertConsentActive,
    recordContribution,
    recordRemittance,
    getReconciliationStatus,
  };
}

/**
 * toBytes32Id
 * -------------
 * Helper to turn a stable, NON-personal string identifier (like a pay
 * period "2026-P01") into the bytes32 the contracts expect. Do not use
 * it for employee IDs: a plain hash of a guessable ID is reversible by
 * anyone reading the public ledger. Use toLedgerEmployeeId in
 * chain/ledgerIds.js instead.
 */
function toBytes32Id(stableString) {
  return ethers.keccak256(ethers.toUtf8Bytes(stableString));
}

module.exports = {
  createChainClient,
  toBytes32Id,
  CONSENT_REGISTRY_ABI,
  RECONCILIATION_LEDGER_ABI,
};

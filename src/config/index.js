// Plain-English overview: centralizes the handful of environment-specific
// values this service needs, so nothing else in the codebase reads
// `process.env` directly. Every value here is read from the environment
// with a safe local-dev fallback - nothing sensitive is hardcoded.

function loadConfig(env = process.env) {
  return {
    rpcUrl: env.NEWCO_RPC_URL || "http://127.0.0.1:8545",
    payrollSignerPrivateKey: env.NEWCO_PAYROLL_SIGNER_KEY || null,
    consentRegistryAddress: env.NEWCO_CONSENT_REGISTRY_ADDRESS || null,
    reconciliationLedgerAddress: env.NEWCO_RECONCILIATION_LEDGER_ADDRESS || null,
    // Secret for deriving on-chain employee IDs (src/chain/ledgerIds.js).
    // No fallback on purpose: chain writes refuse to run without it.
    employeeIdKey: env.NEWCO_EMPLOYEE_ID_KEY || null,
  };
}

module.exports = { loadConfig };

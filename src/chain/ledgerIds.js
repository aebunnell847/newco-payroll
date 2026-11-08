// Plain-English overview: turns a real employee identifier into the
// bytes32 "employeeId" that gets written to the PUBLIC reconciliation
// ledger, without letting anyone outside the employer reverse it.
//
// Why not just keccak256(employee.id)? Every value written to a public
// chain is readable by anyone, forever, and ReconciliationLedger records
// each employee's contribution amount next to their employeeId. A plain
// hash of a guessable identifier (a sequential employee number, an
// email, an SSN) can be brute-forced in seconds: hash every candidate and
// compare. That would expose individual 401(k) deferral amounts.
//
// Instead this uses HMAC-SHA256 with a secret key only the employer's
// payroll operator holds (NEWCO_EMPLOYEE_ID_KEY). Without the key,
// guessing an ID tells you nothing. With it, payroll and anyone it
// deliberately shares the key with (for example the custodian, so it can
// record remittances against the same IDs) get a stable, deterministic
// ledger ID per employee.
//
// What this does NOT hide: the same employee gets the same ledger ID
// every pay period, so an observer can still follow one pseudonym's
// contribution history and amounts, just not attach a name to it.
// Hiding the amounts themselves is an on-chain design question for
// newco-contracts, not something this file can fix.

const crypto = require("crypto");

// Domain separation + version: a key reused elsewhere can't produce the
// same outputs, and a future scheme change can bump the version without
// colliding with IDs already on-chain.
const DOMAIN = "newco:ledger-employee-id:v1:";
const MIN_KEY_BYTES = 32;

/**
 * parseEmployeeIdKey
 * --------------------
 * Accepts the key as hex (with or without 0x), as configured in
 * NEWCO_EMPLOYEE_ID_KEY. Throws with a clear message if it is missing,
 * not hex, or shorter than 32 bytes. Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
function parseEmployeeIdKey(hexKey) {
  if (typeof hexKey !== "string" || hexKey.length === 0) {
    throw new Error("employee ID key is required (set NEWCO_EMPLOYEE_ID_KEY to 32+ random bytes, hex-encoded)");
  }
  const hex = hexKey.startsWith("0x") ? hexKey.slice(2) : hexKey;
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error("employee ID key must be hex-encoded");
  }
  const key = Buffer.from(hex, "hex");
  if (key.length < MIN_KEY_BYTES) {
    throw new Error(`employee ID key must be at least ${MIN_KEY_BYTES} bytes (got ${key.length})`);
  }
  return key;
}

/**
 * toLedgerEmployeeId
 * --------------------
 * HMAC-SHA256(key, DOMAIN + employeeId), returned as a 0x-prefixed
 * 32-byte hex string, the bytes32 ReconciliationLedger expects.
 */
function toLedgerEmployeeId(employeeId, hexKey) {
  if (typeof employeeId !== "string" || employeeId.length === 0) {
    throw new Error("employeeId must be a non-empty string");
  }
  const key = parseEmployeeIdKey(hexKey);
  return "0x" + crypto.createHmac("sha256", key).update(DOMAIN + employeeId, "utf8").digest("hex");
}

module.exports = { toLedgerEmployeeId, parseEmployeeIdKey, MIN_KEY_BYTES };

// Plain-English overview: proves the on-chain employee ID can't be
// recomputed from a guessed employee number without the employer's key,
// while staying stable for anyone who does hold the key.

const crypto = require("crypto");
const { expect } = require("chai");
const { ethers } = require("ethers");
const { toLedgerEmployeeId, parseEmployeeIdKey } = require("../src/chain/ledgerIds");

const KEY_A = "11".repeat(32);
const KEY_B = "22".repeat(32);

describe("toLedgerEmployeeId", () => {
  it("returns a 0x-prefixed 32-byte hex value the contracts accept as bytes32", () => {
    const id = toLedgerEmployeeId("emp-001", KEY_A);
    expect(id).to.match(/^0x[0-9a-f]{64}$/);
    expect(ethers.isHexString(id, 32)).to.equal(true);
  });

  it("is deterministic for the same employee and key", () => {
    expect(toLedgerEmployeeId("emp-001", KEY_A)).to.equal(toLedgerEmployeeId("emp-001", KEY_A));
  });

  it("matches an independent HMAC-SHA256 computation over the documented domain string", () => {
    const expected =
      "0x" +
      crypto
        .createHmac("sha256", Buffer.from(KEY_A, "hex"))
        .update("newco:ledger-employee-id:v1:emp-001", "utf8")
        .digest("hex");
    expect(toLedgerEmployeeId("emp-001", KEY_A)).to.equal(expected);
  });

  it("differs between employees and between keys", () => {
    const a1 = toLedgerEmployeeId("emp-001", KEY_A);
    expect(toLedgerEmployeeId("emp-002", KEY_A)).to.not.equal(a1);
    expect(toLedgerEmployeeId("emp-001", KEY_B)).to.not.equal(a1);
  });

  it("cannot be recovered by brute-forcing guessable IDs with a plain hash", () => {
    // The attack this module exists to stop: hash every plausible ID and
    // look for a match on the public ledger.
    const onChain = toLedgerEmployeeId("E1042", KEY_A);
    const plainGuesses = new Set();
    for (let n = 0; n < 5000; n++) plainGuesses.add(ethers.keccak256(ethers.toUtf8Bytes(`E${n}`)));
    expect(plainGuesses.has(onChain)).to.equal(false);
    // ...whereas the old scheme was trivially recovered:
    expect(plainGuesses.has(ethers.keccak256(ethers.toUtf8Bytes("E1042")))).to.equal(true);
  });

  it("accepts the key with or without a 0x prefix", () => {
    expect(toLedgerEmployeeId("emp-001", "0x" + KEY_A)).to.equal(toLedgerEmployeeId("emp-001", KEY_A));
  });

  it("rejects an empty employee ID", () => {
    expect(() => toLedgerEmployeeId("", KEY_A)).to.throw(/non-empty/);
  });
});

describe("parseEmployeeIdKey", () => {
  it("rejects a missing key with a message naming the env var", () => {
    expect(() => parseEmployeeIdKey(null)).to.throw(/NEWCO_EMPLOYEE_ID_KEY/);
    expect(() => parseEmployeeIdKey("")).to.throw(/NEWCO_EMPLOYEE_ID_KEY/);
  });

  it("rejects non-hex input", () => {
    expect(() => parseEmployeeIdKey("not-a-hex-key-at-all-not-a-hex-key-at-all-not-a-hex-key-at-all!!")).to.throw(/hex/);
  });

  it("rejects keys shorter than 32 bytes", () => {
    expect(() => parseEmployeeIdKey("ab".repeat(31))).to.throw(/at least 32 bytes/);
  });

  it("accepts a 32-byte key", () => {
    expect(parseEmployeeIdKey(KEY_A)).to.have.length(32);
  });
});

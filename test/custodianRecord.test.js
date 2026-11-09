// Plain-English overview: the custodian records what it actually
// received against payroll-supplied ledger IDs, never holds the
// employee-ID key, and never substitutes payroll's instructed amount.

const fs = require("fs");
const path = require("path");
const { expect } = require("chai");
const { recordRemittancesFromInstructions } = require("../src/custodian/recordRemittances");

const PERIOD = "0x" + "c3".repeat(32);
const line = (n, amountCents) => ({
  ledgerEmployeeId: "0x" + String(n).padStart(2, "0").repeat(32),
  ledgerPayPeriodId: PERIOD,
  amountCents,
  withheldAt: 1_790_000_000,
});

function fakeCustodianClient({ failFor = new Set() } = {}) {
  const recorded = [];
  return {
    recorded,
    async recordRemittance(employeeId, payPeriod, amountCents, remittedAt) {
      if (failFor.has(employeeId)) throw new Error("chain call failed");
      recorded.push({ employeeId, payPeriod, amountCents, remittedAt });
    },
  };
}

describe("recordRemittancesFromInstructions", () => {
  it("records each received remittance against the ledger IDs payroll supplied", async () => {
    const client = fakeCustodianClient();
    const lines = [line(1, 24_000)];
    const out = await recordRemittancesFromInstructions(client, lines, () => ({ amountCents: 24_000, remittedAt: 1_790_086_400 }));
    expect(out[0].recorded).to.equal(true);
    expect(client.recorded).to.deep.equal([
      { employeeId: lines[0].ledgerEmployeeId, payPeriod: PERIOD, amountCents: 24_000, remittedAt: 1_790_086_400 },
    ]);
  });

  it("records the amount actually received, not payroll's instructed amount", async () => {
    const client = fakeCustodianClient();
    await recordRemittancesFromInstructions(client, [line(1, 24_000)], () => ({ amountCents: 23_500, remittedAt: 1_790_086_400 }));
    expect(client.recorded[0].amountCents).to.equal(23_500);
  });

  it("refuses to fall back to the instructed amount when the received amount is missing", async () => {
    const client = fakeCustodianClient();
    const out = await recordRemittancesFromInstructions(client, [line(1, 24_000)], () => ({ remittedAt: 1_790_086_400 }));
    expect(out[0].error).to.match(/actual amount received/);
    expect(client.recorded).to.have.length(0);
  });

  it("skips lines with no funds received yet instead of recording anything", async () => {
    const client = fakeCustodianClient();
    const out = await recordRemittancesFromInstructions(client, [line(1, 24_000)], () => null);
    expect(out[0].skipped).to.equal(true);
    expect(client.recorded).to.have.length(0);
  });

  it("isolates one line's failure from the rest", async () => {
    const lines = [line(1, 100), line(2, 200)];
    const client = fakeCustodianClient({ failFor: new Set([lines[0].ledgerEmployeeId]) });
    const out = await recordRemittancesFromInstructions(client, lines, (l) => ({ amountCents: l.amountCents, remittedAt: 1_790_086_400 }));
    expect(out[0].error).to.match(/chain call failed/);
    expect(out[1].recorded).to.equal(true);
  });

  it("never touches the employee-ID key: the custodian module can't compute ledger IDs", () => {
    // Payroll is the system of record for employee IDs. If this ever
    // fails, someone has given custodian code a path to the key.
    const src = fs.readFileSync(path.join(__dirname, "../src/custodian/recordRemittances.js"), "utf8");
    const code = src.replace(/\/\/.*$/gm, ""); // ignore comments that explain the rule
    expect(code).to.not.match(/ledgerIds|EMPLOYEE_ID_KEY|employeeIdKey|createHmac/);
    expect(recordRemittancesFromInstructions.length).to.equal(3); // (client, lines, receiptFor) - no key argument
  });
});

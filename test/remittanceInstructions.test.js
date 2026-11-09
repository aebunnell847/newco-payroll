// Plain-English overview: the remittance instructions payroll hands the
// custodian carry ledger IDs only - never the employee's internal ID or
// the key - and the CSV round-trips strictly.

const { expect } = require("chai");
const {
  buildRemittanceInstructions,
  toRemittanceCsv,
  parseRemittanceCsv,
  CSV_HEADER,
} = require("../src/remittance/instructions");

const ID_A = "0x" + "a1".repeat(32);
const ID_B = "0x" + "b2".repeat(32);
const PERIOD = "0x" + "c3".repeat(32);

const outcome = (employeeId, ledgerEmployeeId, amountCents) => ({
  employee: { id: employeeId, payType: "salary" },
  result: { contribution401k: { actualCents: amountCents } },
  ledgerEntry: { ledgerEmployeeId, ledgerPayPeriodId: PERIOD, amountCents, withheldAt: 1_790_000_000 },
});

describe("buildRemittanceInstructions", () => {
  it("emits one line per employee whose contribution was written on-chain", () => {
    const lines = buildRemittanceInstructions([outcome("emp-001", ID_A, 24_000), outcome("emp-002", ID_B, 0)]);
    expect(lines).to.deep.equal([
      { ledgerEmployeeId: ID_A, ledgerPayPeriodId: PERIOD, amountCents: 24_000, withheldAt: 1_790_000_000 },
      { ledgerEmployeeId: ID_B, ledgerPayPeriodId: PERIOD, amountCents: 0, withheldAt: 1_790_000_000 },
    ]);
  });

  it("never carries the employee's internal ID or any other employee field", () => {
    const lines = buildRemittanceInstructions([outcome("emp-001", ID_A, 24_000)]);
    const serialized = JSON.stringify(lines) + toRemittanceCsv(lines);
    expect(serialized).to.not.include("emp-001");
    expect(Object.keys(lines[0]).sort()).to.deep.equal(["amountCents", "ledgerEmployeeId", "ledgerPayPeriodId", "withheldAt"]);
  });

  it("leaves out skipped, failed, and dry-run outcomes (nothing on-chain to reconcile)", () => {
    const lines = buildRemittanceInstructions([
      { employee: { id: "emp-skip" }, skipped: true, skipReason: "no consent" },
      { employee: { id: "emp-err" }, error: "boom" },
      { employee: { id: "emp-dry" }, result: { contribution401k: { actualCents: 5 } } },
      outcome("emp-001", ID_A, 24_000),
    ]);
    expect(lines).to.have.length(1);
    expect(lines[0].ledgerEmployeeId).to.equal(ID_A);
  });

  it("rejects duplicate entries for the same employee and pay period", () => {
    expect(() => buildRemittanceInstructions([outcome("x", ID_A, 1), outcome("y", ID_A, 2)])).to.throw(/duplicate/);
  });
});

describe("remittance CSV", () => {
  const lines = [
    { ledgerEmployeeId: ID_A, ledgerPayPeriodId: PERIOD, amountCents: 24_000, withheldAt: 1_790_000_000 },
    { ledgerEmployeeId: ID_B, ledgerPayPeriodId: PERIOD, amountCents: 0, withheldAt: 1_790_000_001 },
  ];

  it("round-trips exactly", () => {
    expect(parseRemittanceCsv(toRemittanceCsv(lines))).to.deep.equal(lines);
  });

  it("starts with the fixed header", () => {
    expect(toRemittanceCsv(lines).split("\n")[0]).to.equal(CSV_HEADER);
  });

  it("accepts Windows line endings", () => {
    expect(parseRemittanceCsv(toRemittanceCsv(lines).replace(/\n/g, "\r\n"))).to.deep.equal(lines);
  });

  it("rejects a file with the wrong header", () => {
    expect(() => parseRemittanceCsv("employee_id,amount\nemp-001,100\n")).to.throw(/header/);
  });

  it("rejects a raw employee ID where a ledger ID belongs, naming the line", () => {
    const bad = `${CSV_HEADER}\nemp-001,${PERIOD},100,1790000000\n`;
    expect(() => parseRemittanceCsv(bad)).to.throw(/line 2: ledger_employee_id/);
  });

  it("rejects non-integer or negative amounts", () => {
    expect(() => parseRemittanceCsv(`${CSV_HEADER}\n${ID_A},${PERIOD},12.50,1790000000\n`)).to.throw(/amount_cents/);
    expect(() => parseRemittanceCsv(`${CSV_HEADER}\n${ID_A},${PERIOD},-5,1790000000\n`)).to.throw(/amount_cents/);
  });

  it("rejects rows with the wrong number of columns", () => {
    expect(() => parseRemittanceCsv(`${CSV_HEADER}\n${ID_A},${PERIOD},100\n`)).to.throw(/4 columns/);
  });

  it("rejects duplicate rows", () => {
    const dup = `${CSV_HEADER}\n${ID_A},${PERIOD},100,1790000000\n${ID_A},${PERIOD},100,1790000000\n`;
    expect(() => parseRemittanceCsv(dup)).to.throw(/duplicate/);
  });
});

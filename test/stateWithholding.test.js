// Plain-English overview: state withholding checked against each state
// agency's OWN published worked examples (EDD Method B Examples A-F,
// Illinois IL-700-T examples for 2025 and 2026), plus the rules each state
// sets for wage basis, missing forms, and unsupported states or years.

const { expect } = require("chai");
const { computeStateWithholdingCents, SUPPORTED_STATES } = require("../src/regulatory/state");
const ca = require("../src/regulatory/state/ca");

const run = (state, wagesCents, payPeriodsPerYear, form, { taxYear = 2026, grossPayCents = wagesCents } = {}) =>
  computeStateWithholdingCents({
    state,
    taxYear,
    grossPayCents,
    federalTaxableWagesCents: wagesCents,
    payPeriodsPerYear,
    form,
  });

describe("state withholding: registry", () => {
  it("lists exactly the states with a sourced method", () => {
    expect(SUPPORTED_STATES).to.deep.equal([
      "AK", "AL", "AR", "AZ", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "IA", "ID", "IL", "IN", "KS", "KY", "LA",
      "MD", "ME", "MI", "MN", "MO", "MS", "MT", "NC", "ND", "NE", "NH", "NJ", "NM", "NV", "NY", "OH", "OK", "OR",
      "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VA", "VT", "WA", "WI", "WV", "WY",
    ]);
  });

  it("refuses an unsupported state, a missing state, or an unsourced year", () => {
    expect(() => run("PR", 100_000, 52, null)).to.throw(/no sourced withholding method for state "PR"/);
    expect(() => run(undefined, 100_000, 52, null)).to.throw(/no work state on file/);
    expect(() => run("CA", 100_000, 52, null, { taxYear: 2025 })).to.throw(/no sourced California withholding for tax year 2025/);
    expect(() => run("WA", 100_000, 52, null, { taxYear: 2028 })).to.throw(/Washington withholding for tax year 2028/);
  });
});

describe("California (EDD Method B, 2026)", () => {
  // EDD's own examples, "California Withholding Schedules for 2026 - Method B".
  it("Example A: weekly $210, single, 1 allowance -> under the low-income exemption, $0", () => {
    expect(run("CA", 210_00, 52, { filingStatus: "single", regularAllowances: 1 }).stateCents).to.equal(0);
  });

  it("Example B: biweekly $1,600, married, 2 regular + 1 estimated-deduction allowance -> $2.38", () => {
    const form = { filingStatus: "married", regularAllowances: 2, estimatedDeductionAllowances: 1 };
    expect(run("CA", 1_600_00, 26, form).stateCents).to.equal(2_38);
  });

  it("Example E: semi-monthly $2,400, married, 4 allowances -> $4.13", () => {
    expect(run("CA", 2_400_00, 24, { filingStatus: "married", regularAllowances: 4 }).stateCents).to.equal(4_13);
  });

  it("Example F: monthly $4,750, married, 4 allowances -> $7.17", () => {
    expect(run("CA", 4_750_00, 12, { filingStatus: "married", regularAllowances: 4 }).stateCents).to.equal(7_17);
  });

  it("Examples C and D: within 2 cents (EDD worked these with per-period tables; this uses the annual method EDD allows)", () => {
    const c = run("CA", 5_100_00, 12, { filingStatus: "married", regularAllowances: 5 }).stateCents;
    const d = run("CA", 950_00, 52, { filingStatus: "headOfHousehold", regularAllowances: 3 }).stateCents;
    expect(Math.abs(c - 82)).to.be.at.most(2);
    expect(Math.abs(d - 1_69)).to.be.at.most(2);
  });

  it("withholds as Single with zero allowances when no DE 4 is on file (DE 44)", () => {
    const none = run("CA", 2_000_00, 26, null);
    const single0 = run("CA", 2_000_00, 26, { filingStatus: "single", regularAllowances: 0 });
    expect(none.stateCents).to.equal(single0.stateCents);
    expect(none.formBasis).to.equal("none-on-file");
  });

  it("uses federal income-tax wages (pre-tax 401(k) excluded, per EDD DE 231A)", () => {
    const r = run("CA", 3_800_00, 26, null, { grossPayCents: 4_000_00 });
    expect(r.wageBasis).to.equal("federal-income-tax-wages");
    expect(r.wagesCents).to.equal(3_800_00);
  });

  it("honors exempt and additional withholding", () => {
    expect(run("CA", 5_000_00, 26, { filingStatus: "single", regularAllowances: 0, exempt: true }).stateCents).to.equal(0);
    const base = run("CA", 5_000_00, 26, { filingStatus: "single", regularAllowances: 1 }).stateCents;
    const extra = run("CA", 5_000_00, 26, { filingStatus: "single", regularAllowances: 1, additionalWithholdingCents: 10_00 });
    expect(extra.stateCents).to.equal(base + 10_00);
  });

  it("validates the DE 4", () => {
    expect(() => run("CA", 1, 26, { filingStatus: "joint", regularAllowances: 0 })).to.throw(/California DE 4: filingStatus/);
    expect(() => run("CA", 1, 26, { filingStatus: "single", regularAllowances: -1 })).to.throw(/regularAllowances/);
  });

  for (const [status, rows] of Object.entries(ca.TABLES[2026].brackets)) {
    it(`annual ${status} brackets: each bracket's base follows from the one before`, () => {
      expect(rows).to.have.length(10);
      for (let i = 1; i < rows.length; i++) {
        const [prevOver, prevPlus, prevRate] = rows[i - 1];
        const [over, plus] = rows[i];
        const implied = prevPlus + ((over - prevOver) * prevRate) / 100_000;
        expect(Math.abs(implied - plus), `row ${i}`).to.be.at.most(100);
      }
    });
  }
});

describe("Illinois (IL-700-T automated payroll method)", () => {
  const alice = { line1Allowances: 2, line2Allowances: 2 };

  it("2026 example: $800 weekly, 2 + 2 allowances -> $32.13", () => {
    expect(run("IL", 800_00, 52, alice).stateCents).to.equal(32_13);
  });

  it("2025 example: same employee at the 2025 $2,850 exemption -> $32.27", () => {
    expect(run("IL", 800_00, 52, alice, { taxYear: 2025 }).stateCents).to.equal(32_27);
  });

  it("allows no exemptions when no IL-W-4 is on file (IL-W-4 instructions)", () => {
    const r = run("IL", 800_00, 52, null);
    expect(r.stateCents).to.equal(39_60); // 4.95% x $800
    expect(r.formBasis).to.equal("none-on-file");
  });

  it("adds the Line 3 additional amount and never goes below it", () => {
    const r = run("IL", 10_00, 52, { line1Allowances: 5, line2Allowances: 0, additionalWithholdingCents: 5_00 });
    expect(r.stateCents).to.equal(5_00);
  });
});

describe("Pennsylvania (flat 3.07%)", () => {
  it("taxes GROSS pay, 401(k) deferrals included (REV-415)", () => {
    const r = run("PA", 3_800_00, 26, null, { grossPayCents: 4_000_00 });
    expect(r.wageBasis).to.equal("gross");
    expect(r.stateCents).to.equal(122_80);
  });

  it("has no state certificate to accept", () => {
    expect(() => run("PA", 1, 26, { anything: true })).to.throw(/no state withholding certificate/);
  });
});

describe("no-income-tax states", () => {
  for (const state of ["AK", "FL", "NH", "NV", "SD", "TN", "TX", "WA", "WY"]) {
    it(`${state}: withholds nothing in 2025 and 2026`, () => {
      expect(run(state, 10_000_00, 26, null).stateCents).to.equal(0);
      expect(run(state, 10_000_00, 26, null, { taxYear: 2025 }).stateCents).to.equal(0);
    });
  }
});

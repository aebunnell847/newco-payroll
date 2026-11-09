// Plain-English overview: Alabama, Arkansas, Kansas, Montana, Nebraska and
// Wisconsin withholding, each checked against its agency's worked examples
// or printed tables.

const { expect } = require("chai");
const al = require("../src/regulatory/state/al");
const ar = require("../src/regulatory/state/ar");
const ks = require("../src/regulatory/state/ks");
const mt = require("../src/regulatory/state/mt");
const ne = require("../src/regulatory/state/ne");
const wi = require("../src/regulatory/state/wi");

const at = (m, wagesCents, payPeriodsPerYear, form = null, extra = {}) =>
  m.compute({ taxYear: 2026, wagesCents, payPeriodsPerYear, form, payDate: "2026-11-06", ...extra });

describe("Alabama (Jan. 2026 booklet formula)", () => {
  it("booklet example: M-2, $850 weekly, federal $35.19 -> $29.59", () => {
    const r = at(al, 850_00, 52, { exemption: "M", dependents: 2 }, { federalWithholdingCents: 35_19 });
    expect(r.stateCents).to.equal(29_59);
  });
  it("standard deduction phase-down matches the printed schedule", () => {
    const sd = (s, gi) => al.standardDeductionCents(s, gi * 100) / 100;
    expect([sd("M", 25_999), sd("M", 26_000), sd("M", 35_499), sd("M", 35_500)]).to.deep.equal([8_500, 8_325, 5_175, 5_000]);
    expect([sd("MS", 13_000), sd("MS", 17_749), sd("MS", 17_750)]).to.deep.equal([4_162, 2_578, 2_500]);
    expect([sd("H", 26_000), sd("H", 35_000)]).to.deep.equal([5_065, 2_635]);
    expect([sd("S", 26_000), sd("S", 35_499)]).to.deep.equal([2_975, 2_525]);
  });
  it("needs this period's federal withholding", () => {
    expect(() => at(al, 850_00, 52, { exemption: "S", dependents: 0 })).to.throw(/federalWithholdingCents is required/);
  });
  it("no A-4: zero exemptions", () =>
    expect(at(al, 850_00, 52, null, { federalWithholdingCents: 0 }).formBasis).to.equal("none-on-file-zero-exemptions"));
});

describe("Arkansas (formula method effective 01/01/2026)", () => {
  it("formula example: Gary, $2,127 monthly, 2 exemptions -> $36.50", () => {
    const r = at(ar, 2_127_00, 12, { exemptions: 2 });
    expect(r.lines.incomeCents).to.equal(23_050_00);
    expect(r.lines.grossTaxCents).to.equal(496_00);
    expect(r.stateCents).to.equal(36_50);
  });
  it("has the generated bracket table, including the top phase-out rows", () => {
    const b = ar.TABLES[2026].brackets;
    expect(b[0]).to.deep.equal([0, 0, 0]);
    expect(b[b.length - 1]).to.deep.equal([97_601_00, 370, 79_90]);
  });
  it("uses the exact dollar figure at $100,001 and over", () => {
    const r = at(ar, 120_000_00, 1, { exemptions: 0 });
    expect(r.lines.incomeCents).to.equal(117_530_00);
  });
  it("no AR4EC: no exemptions; low-income line 5 is not supported yet", () => {
    expect(at(ar, 2_127_00, 12).lines.creditsCents).to.equal(0);
    expect(() => at(ar, 2_127_00, 12, { exemptions: 1, lowIncome: true })).to.throw(/low-income/);
  });
});

describe("Kansas (percentage tables, wages paid on and after July 1, 2024)", () => {
  it("KW-100 example: Esmeralda, $2,000 semimonthly, married, 1 dependent -> $41.44", () => {
    const r = at(ks, 2_000_00, 24, { filingStatus: "married", personalExemptions: 2, dependents: 1 });
    expect(r.lines.allowanceCents).to.equal(860_00);
    expect(r.stateCents).to.equal(41_44);
  });
  it("head of household gets the extra $2,320 and uses the single table", () => {
    const r = at(ks, 2_000_00, 24, { filingStatus: "headOfHousehold", personalExemptions: 1, dependents: 0 });
    expect(r.lines.status).to.equal("single");
    expect(r.lines.allowanceCents).to.equal(Math.round(916_000 / 24) + Math.round(232_000 / 24));
  });
  it("covers 2025 and 2026; no K-4: single, no allowances", () => {
    expect(ks.years).to.deep.equal([2025, 2026]);
    expect(at(ks, 2_000_00, 24).formBasis).to.equal("none-on-file-single-zero");
  });
});

describe("Montana (2026 guide formula: all nine examples)", () => {
  const ex = (status, wages, n) => at(mt, wages, n, { filingStatus: status }).stateCents / 100;
  it("single / both-working tables", () => {
    expect([ex("single", 1_375_00, 24), ex("single", 2_950_00, 26), ex("single", 475_00, 52)]).to.deep.equal([33, 114, 8]);
  });
  it("married filing jointly tables", () => {
    expect([ex("marriedJoint", 1_375_00, 24), ex("marriedJoint", 5_950_00, 26), ex("marriedJoint", 725_00, 52)]).to.deep.equal([2, 232, 5]);
  });
  it("head of household tables (round to nearest, as the examples do: $17.34 -> $17)", () => {
    expect([ex("headOfHousehold", 1_375_00, 24), ex("headOfHousehold", 4_950_00, 26), ex("headOfHousehold", 575_00, 52)]).to.deep.equal([17, 201, 5]);
  });
  it("has no quarterly table", () => expect(() => at(mt, 1, 4)).to.throw(/no withholding table for 4/));
});

describe("Nebraska (2026 Circular EN percentage method)", () => {
  it("$1,000 weekly, single, 1 allowance -> $25.85 + 4.48% x ($953.08 - $772)", () => {
    expect(at(ne, 1_000_00, 52, { filingStatus: "single", allowances: 1 }).stateCents).to.equal(Math.round(2_585 + 18_108 * 0.0448));
  });
  it("each table's bases follow from the bracket below (within a cent)", () => {
    for (const byStatus of Object.values(ne.TABLES[2026].percentageTables)) {
      for (const rows of Object.values(byStatus)) {
        for (let i = 2; i < rows.length; i++) {
          const [o0, b0, r0] = rows[i - 1];
          expect(Math.abs(b0 + ((rows[i][0] - o0) * r0) / 10_000 - rows[i][1])).to.be.at.most(1);
        }
      }
    }
  });
  it("applies the 1.5% minimum: 50% of the single-one-allowance amount", () => {
    const r = at(ne, 1_000_00, 52, { filingStatus: "single", allowances: 12 });
    expect(r.lines.minimumApplied).to.equal(true);
    expect(r.stateCents).to.equal(Math.round(0.5 * (2_585 + 18_108 * 0.0448)));
  });
  it("no W-4N: a pre-2020 federal W-4's status and allowances, else single with none", () => {
    expect(at(ne, 1_000_00, 52, null, { federalW4: { formYear: 2019, maritalStatus: "married", allowances: 2 } }).formBasis).to.equal("federal-w4-pre-2020");
    expect(at(ne, 1_000_00, 52, null, { federalW4: { formYear: 2024, filingStatus: "marriedFilingJointly" } }).lines.status).to.equal("single");
  });
});

describe("Wisconsin (W-166 alternate method)", () => {
  it("Example 1: $350 weekly, single, 1 exemption -> $7.59", () =>
    expect(at(wi, 350_00, 52, { filingStatus: "single", exemptions: 1 }).stateCents).to.equal(7_59));
  it("Example 2: $500 weekly, single, 3 exemptions -> $14.34", () =>
    expect(at(wi, 500_00, 52, { filingStatus: "single", exemptions: 3 }).stateCents).to.equal(14_34));
  it("married deduction phases out between $25,727 and $73,032", () => {
    expect(at(wi, 25_000_00, 1, { filingStatus: "married", exemptions: 0 }).lines.deductionCents).to.equal(9_461_00);
    expect(at(wi, 80_000_00, 1, { filingStatus: "married", exemptions: 0 }).lines.deductionCents).to.equal(0);
  });
  it("no WT-4: zero exemptions", () => expect(at(wi, 350_00, 52).formBasis).to.equal("none-on-file-zero-exemptions"));
});

describe("federal withholding reaches Alabama's rules through the payroll engine", () => {
  it("deducts the period's actual federal withholding, annualized", () => {
    const { computeTaxWithholdingCents } = require("../src/payroll/payrollEngine");
    const r = computeTaxWithholdingCents({
      taxYear: 2026,
      grossPayCents: 850_00,
      payPeriodsPerYear: 52,
      w4: { formYear: 2024, filingStatus: "marriedFilingJointly" },
      workState: "AL",
      stateW4: { exemption: "M", dependents: 2 },
      payDate: "2026-11-06",
    });
    const direct = al.compute({
      taxYear: 2026,
      wagesCents: 850_00,
      payPeriodsPerYear: 52,
      form: { exemption: "M", dependents: 2 },
      federalWithholdingCents: r.federalCents,
    });
    expect(r.stateCents).to.equal(direct.stateCents);
  });
});

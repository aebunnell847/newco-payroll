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

describe("Nebraska (2027 Circular EN percentage method)", () => {
  // Circular EN for wages paid on or after January 1, 2027:
  // https://revenue.nebraska.gov/sites/default/files/doc/business/Cir_En_2026/2027_percent.pdf
  // https://revenue.nebraska.gov/sites/default/files/doc/business/Cir_En_2026/2027_instruct.pdf
  // It prints no worked example, so these are worked by hand from the printed tables.
  const at27 = (wagesCents, n, form = null, extra = {}) =>
    ne.compute({ taxYear: 2027, wagesCents, payPeriodsPerYear: n, form, payDate: "2027-01-15", ...extra });

  it("allowance values are $2,510 / periods (daily / 260), as printed", () => {
    const n = { daily: 260, weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12, quarterly: 4, semiannual: 2, annual: 1 };
    for (const [p, v] of Object.entries(ne.TABLES[2027].allowanceCents)) expect(v, p).to.equal(Math.round(2_510_00 / n[p]));
    expect(ne.TABLES[2027].allowanceCents.weekly).to.equal(48_27);
  });

  it("every table uses the 2027 rates 2.26 / 3.22 / 3.69 / 3.81 / 3.93 / 4.03%", () => {
    for (const byStatus of Object.values(ne.TABLES[2027].percentageTables)) {
      for (const rows of Object.values(byStatus)) expect(rows.map((r) => r[2])).to.deep.equal([0, 226, 322, 369, 381, 393, 403]);
    }
  });

  it("each table's bases follow from the bracket below (within a cent)", () => {
    for (const byStatus of Object.values(ne.TABLES[2027].percentageTables)) {
      for (const rows of Object.values(byStatus)) {
        for (let i = 2; i < rows.length; i++) {
          const [o0, b0, r0] = rows[i - 1];
          expect(Math.abs(b0 + ((rows[i][0] - o0) * r0) / 10_000 - rows[i][1])).to.be.at.most(1);
        }
      }
    }
  });

  it("annual brackets as printed: single over $3,530 / married over $8,430; tops over $77,590 / $85,370", () => {
    const { single, married } = ne.TABLES[2027].percentageTables.annual;
    expect([single[1][0], single.at(-1)[0], single.at(-1)[1]]).to.deep.equal([3_530_00, 77_590_00, 2_709_04]);
    expect([married[1][0], married.at(-1)[0], married.at(-1)[1]]).to.deep.equal([8_430_00, 85_370_00, 2_739_68]);
  });

  it("$1,000 weekly, single, 1 allowance -> $30.86", () => {
    // 1,000 - 48.27 = 951.73; over 794 (Table 1a): 24.66 + 3.93% x (951.73 - 794) = 24.66 + 6.1988 = 30.8588
    expect(at27(1_000_00, 52, { filingStatus: "single", allowances: 1 }).stateCents).to.equal(30_86);
  });

  it("$2,000 biweekly, married, 2 allowances -> $48.38", () => {
    // 2,000 - 2 x 96.54 = 1,806.92; over 1,283 (Table 2b): 29.05 + 3.69% x (1,806.92 - 1,283) = 29.05 + 19.3326 = 48.3826
    expect(at27(2_000_00, 26, { filingStatus: "married", allowances: 2 }).stateCents).to.equal(48_38);
  });

  it("$5,000 monthly, no W-4N (2020+ federal W-4) -> single, no allowances: $168.14", () => {
    // 5,000 - 0 = 5,000; over 3,443 (Table 4a): 106.95 + 3.93% x (5,000 - 3,443) = 106.95 + 61.1901 = 168.1401
    const r = at27(5_000_00, 12, null, { federalW4: { formYear: 2024, filingStatus: "marriedFilingJointly" } });
    expect(r.lines.status).to.equal("single");
    expect(r.formBasis).to.equal("none-on-file-single-zero");
    expect(r.stateCents).to.equal(168_14);
  });

  it("top bracket: $2,000 weekly, single, 0 allowances -> $72.56", () => {
    // over 1,492 (Table 1a): 52.09 + 4.03% x (2,000 - 1,492) = 52.09 + 20.4724 = 72.5624
    expect(at27(2_000_00, 52, { filingStatus: "single", allowances: 0 }).stateCents).to.equal(72_56);
  });

  it("nothing below the first edge: $60 weekly, single, 0 allowances -> $0 (not over $68)", () => {
    expect(at27(60_00, 52, { filingStatus: "single", allowances: 0 }).stateCents).to.equal(0);
  });

  it("applies the 1.5% minimum: 50% of the single-one-allowance amount", () => {
    // 12 allowances: 1,000 - 579.24 = 420.76; over 133: 1.47 + 3.22% x 287.76 = 10.74 < 1.5% x 1,000 = 15.00,
    // so withhold 50% x 30.8588 (the single-one-allowance amount above) = 15.43
    const r = at27(1_000_00, 52, { filingStatus: "single", allowances: 12 });
    expect(r.lines.minimumApplied).to.equal(true);
    expect(r.stateCents).to.equal(15_43);
  });

  it("leaves 2026 untouched: $1,000 weekly, single, 1 allowance is still the 2026 amount", () => {
    expect(at(ne, 1_000_00, 52, { filingStatus: "single", allowances: 1 }).stateCents).to.equal(Math.round(2_585 + 18_108 * 0.0448));
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

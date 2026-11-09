// SPDX-License-Identifier: MIT
//
// Plain-English overview: the employee's share of FICA - Social Security
// and Medicare tax, plus Additional Medicare Tax withholding - per IRS
// Publication 15 (Circular E). Figures are by tax year, cited, and a
// missing year throws, the same as irsLimits.js.
//
// FICA wages here are gross pay. Traditional 401(k) deferrals do NOT
// reduce FICA wages (they reduce only income-tax wages), which is why this
// takes gross and federalWithholding.js takes gross minus deferrals.
// Section 125 cafeteria-plan deductions, which would reduce both, aren't
// modeled yet.
//
// Rates are basis points: 620 = 6.2%.

const FICA = Object.freeze({
  2025: Object.freeze({
    socialSecurityRateBp: 620,
    socialSecurityWageBaseCents: 176_100_00,
    medicareRateBp: 145,
    additionalMedicareRateBp: 90,
    additionalMedicareThresholdCents: 200_000_00,
    sources: Object.freeze([
      "IRS Publication 15 (2025), Circular E: https://www.irs.gov/pub/irs-prior/p15--2025.pdf",
    ]),
  }),
  2026: Object.freeze({
    socialSecurityRateBp: 620,
    socialSecurityWageBaseCents: 184_500_00,
    medicareRateBp: 145,
    additionalMedicareRateBp: 90,
    additionalMedicareThresholdCents: 200_000_00,
    sources: Object.freeze(["IRS Publication 15 (2026), Circular E: https://www.irs.gov/publications/p15"]),
  }),
});

function getFicaRates(taxYear) {
  const rates = FICA[taxYear];
  if (!rates) {
    throw new Error(
      `no sourced FICA rates for tax year ${taxYear} (have: ${Object.keys(FICA).join(", ")}); ` +
        "add them from that year's Publication 15 before running payroll for it"
    );
  }
  return rates;
}

const pct = (cents, bp) => Math.round((cents * bp) / 10_000);

/**
 * computeFicaCents
 * -----------------
 * ficaWagesCents: this period's FICA wages (gross pay).
 * yearToDateFicaWagesCents: FICA wages already paid to this employee
 *   earlier in the same calendar year, by this employer. Needed for the
 *   Social Security wage base and the Additional Medicare threshold, both
 *   of which apply per employer per calendar year.
 */
function computeFicaCents({ taxYear, ficaWagesCents, yearToDateFicaWagesCents = 0 }) {
  const r = getFicaRates(taxYear);
  for (const [name, v] of [
    ["ficaWagesCents", ficaWagesCents],
    ["yearToDateFicaWagesCents", yearToDateFicaWagesCents],
  ]) {
    if (!Number.isSafeInteger(v) || v < 0) throw new Error(`${name} must be a non-negative integer`);
  }

  const ssRoomCents = Math.max(0, r.socialSecurityWageBaseCents - yearToDateFicaWagesCents);
  const socialSecurityWagesCents = Math.min(ficaWagesCents, ssRoomCents);

  const overThresholdAfter = Math.max(0, yearToDateFicaWagesCents + ficaWagesCents - r.additionalMedicareThresholdCents);
  const overThresholdBefore = Math.max(0, yearToDateFicaWagesCents - r.additionalMedicareThresholdCents);
  const additionalMedicareWagesCents = overThresholdAfter - overThresholdBefore;

  const socialSecurityCents = pct(socialSecurityWagesCents, r.socialSecurityRateBp);
  const medicareCents = pct(ficaWagesCents, r.medicareRateBp);
  const additionalMedicareCents = pct(additionalMedicareWagesCents, r.additionalMedicareRateBp);

  return {
    socialSecurityWagesCents,
    socialSecurityCents,
    medicareCents,
    additionalMedicareWagesCents,
    additionalMedicareCents,
    totalCents: socialSecurityCents + medicareCents + additionalMedicareCents,
  };
}

module.exports = { FICA, getFicaRates, computeFicaCents };

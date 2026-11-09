// SPDX-License-Identifier: MIT
//
// Federal income tax withholding on supplemental wages (bonuses,
// commissions, awards, ...): Publication 15 (2026), section 7.
//
// - Supplemental wages above $1 million in the calendar year: "the excess
//   is subject to withholding at 37% (or the highest rate of income tax for
//   the year). Withhold using the 37% rate without regard to the employee's
//   Form W-4." Mandatory.
// - Up to $1 million, when the supplemental amount is identified separately
//   from regular wages:
//     (a) "Withhold a flat 22% (no other percentage allowed)", or
//     (b) add it to the concurrently paid regular wages and withhold as if
//         the total were a single payment (the "aggregate" procedure).
//   The flat option is only available if income tax was withheld from the
//   employee's regular wages in the current or preceding calendar year;
//   otherwise use (b). Payroll here defaults to (b), which is always
//   allowed, and uses (a) only when the plan elects it.
// - "Regardless of the method ... they're subject to social security,
//   Medicare, and FUTA taxes."
//
// States: supplemental pay is combined with regular pay for state
// withholding (the "single payment" method every state guide here allows);
// states' optional flat supplemental rates aren't used.

const FEDERAL_SUPPLEMENTAL = Object.freeze({
  2026: Object.freeze({
    flatRateBp: 2_200,
    mandatoryRateBp: 3_700,
    mandatoryThresholdCents: 1_000_000_00,
    sources: Object.freeze([
      "IRS, Publication 15 (2026), section 7, Supplemental Wages: https://www.irs.gov/pub/irs-pdf/p15.pdf",
    ]),
  }),
});

const METHODS = ["aggregate", "flat"];

function getSupplementalRules(taxYear) {
  const t = FEDERAL_SUPPLEMENTAL[taxYear];
  if (!t) {
    throw new Error(
      `no sourced federal supplemental-wage rules for tax year ${taxYear} (have: ${Object.keys(FEDERAL_SUPPLEMENTAL).join(", ")})`
    );
  }
  return t;
}

/**
 * Split this paycheck's taxable supplemental wages into the part above the
 * year's $1 million (mandatory 37%) and the rest.
 *   supplementalTaxableCents   - this paycheck's supplemental wages, net of
 *                                the pre-tax deferral share
 *   supplementalCents          - the gross supplemental amount
 *   yearToDateSupplementalCents - supplemental wages already paid this year
 */
function splitAtMillion(t, { supplementalTaxableCents, supplementalCents, yearToDateSupplementalCents }) {
  const over = Math.min(supplementalCents, Math.max(0, yearToDateSupplementalCents + supplementalCents - t.mandatoryThresholdCents));
  const mandatoryTaxable = supplementalCents > 0 ? Math.round((supplementalTaxableCents * over) / supplementalCents) : 0;
  return { mandatoryTaxableCents: mandatoryTaxable, ordinaryTaxableCents: supplementalTaxableCents - mandatoryTaxable };
}

module.exports = { FEDERAL_SUPPLEMENTAL, METHODS, getSupplementalRules, splitAtMillion };

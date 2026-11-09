// SPDX-License-Identifier: MIT
//
// Plain-English overview: the IRS dollar limits that decide how much an
// employee can defer into a 401(k) in a given tax year. Every figure here
// is copied from an IRS primary source, cited next to it, and keyed by tax
// year. There is no fallback: asking for a year that isn't listed throws,
// so payroll can never quietly run on a stale or guessed limit.
//
// Adding a new year: copy the figures from that year's IRS cost-of-living
// notice (published each fall in the Internal Revenue Bulletin) into a new
// entry, cite it, and add a test that pins the new numbers.
//
// This is a sourced table, not the regulatory RAG system the docs describe.
// When that exists, it should produce entries in exactly this shape, with
// citations, and this file's tests should keep passing against it.

const IRS_DEFERRAL_LIMITS = Object.freeze({
  2025: Object.freeze({
    taxYear: 2025,
    // IRC 402(g)(1): elective deferral limit
    electiveDeferralLimitCents: 23_500_00,
    // IRC 414(v)(2)(B)(i): catch-up limit, age 50+
    catchUpLimitCents: 7_500_00,
    // IRC 414(v)(2)(E): catch-up limit for ages 60-63 (SECURE 2.0 sec. 109)
    catchUpLimitAge60to63Cents: 11_250_00,
    // IRC 414(v)(7): the Roth catch-up requirement was under the IRS
    // administrative transition period through 2025 (Notice 2023-62), so
    // it is not applied for 2025.
    rothCatchUpRequirementApplies: false,
    rothCatchUpWageThresholdCents: null,
    // IRC 415(c)(1)(A) and 401(a)(17): recorded for future use (employer
    // contributions and compensation caps aren't modeled yet).
    annualAdditionsLimitCents: 70_000_00,
    compensationLimitCents: 350_000_00,
    sources: Object.freeze([
      "IRS Publication 560 (2025): https://www.irs.gov/publications/p560",
      "IRS Publication 17 (2025): https://www.irs.gov/publications/p17",
      "IRS Notice 2025-67 (states the 2025 figures each 2026 figure increased from), IRB 2025-49: https://www.irs.gov/irb/2025-49_IRB",
    ]),
  }),
  2026: Object.freeze({
    taxYear: 2026,
    electiveDeferralLimitCents: 24_500_00,
    catchUpLimitCents: 8_000_00,
    catchUpLimitAge60to63Cents: 11_250_00,
    // IRC 414(v)(7)(A): if the employee's prior-year (2025) FICA wages from
    // this employer exceeded this amount, their 2026 catch-up contributions
    // must be designated Roth.
    rothCatchUpRequirementApplies: true,
    rothCatchUpWageThresholdCents: 150_000_00,
    annualAdditionsLimitCents: 72_000_00,
    compensationLimitCents: 360_000_00,
    sources: Object.freeze([
      "IRS Notice 2025-67, IRB 2025-49: https://www.irs.gov/irb/2025-49_IRB",
      "IRS news release IR-2025-111 (Nov. 13, 2025): https://www.irs.gov/newsroom/401k-limit-increases-to-24500-for-2026-ira-limit-increases-to-7500",
    ]),
  }),
});

/** The sourced limits for one tax year. Throws if the year isn't listed. */
function getDeferralLimits(taxYear) {
  if (!Number.isInteger(taxYear)) {
    throw new Error("taxYear must be an integer year, e.g. 2026");
  }
  const limits = IRS_DEFERRAL_LIMITS[taxYear];
  if (!limits) {
    const known = Object.keys(IRS_DEFERRAL_LIMITS).join(", ");
    throw new Error(
      `no sourced IRS deferral limits for tax year ${taxYear} (have: ${known}); ` +
        "add them from that year's IRS notice before running payroll for it"
    );
  }
  return limits;
}

/**
 * Which catch-up band applies. The IRS test is the age the employee
 * attains by the END of the tax year, which is exactly taxYear - birthYear,
 * so a birth year is all this needs (no full date of birth).
 *
 * Returns "none" | "standard" | "age60to63". Without a birth year the
 * answer is "none": catch-up is never assumed.
 */
function catchUpBand(taxYear, birthYear) {
  if (birthYear === undefined || birthYear === null) return "none";
  if (!Number.isInteger(birthYear) || birthYear > taxYear) {
    throw new Error("birthYear must be an integer year no later than the tax year");
  }
  const ageAtYearEnd = taxYear - birthYear;
  if (ageAtYearEnd >= 60 && ageAtYearEnd <= 63) return "age60to63";
  if (ageAtYearEnd >= 50) return "standard";
  return "none";
}

/**
 * The most this employee can defer in the year: the 402(g) limit, plus the
 * catch-up for their age band if the plan offers catch-up contributions.
 * Catch-up is a plan feature, not a right, so it's only added when the
 * caller says the plan allows it.
 */
function annualDeferralCapCents({ taxYear, birthYear, planAllowsCatchUp = false }) {
  const limits = getDeferralLimits(taxYear);
  const band = planAllowsCatchUp ? catchUpBand(taxYear, birthYear) : "none";
  const catchUpCents =
    band === "age60to63"
      ? limits.catchUpLimitAge60to63Cents
      : band === "standard"
        ? limits.catchUpLimitCents
        : 0;
  return {
    baseLimitCents: limits.electiveDeferralLimitCents,
    catchUpCents,
    totalCents: limits.electiveDeferralLimitCents + catchUpCents,
    catchUpBand: band,
  };
}

/**
 * Whether catch-up dollars must go in as Roth (IRC 414(v)(7)).
 *   false - no catch-up dollars, or the rule doesn't apply this year, or
 *           prior-year FICA wages were at or under the threshold
 *   true  - prior-year FICA wages exceeded the threshold
 *   null  - unknown: there are catch-up dollars but no prior-year FICA
 *           wage figure. A person has to resolve it; this never guesses.
 */
function rothCatchUpRequired({ taxYear, catchUpPortionCents, priorYearFicaWagesCents }) {
  const limits = getDeferralLimits(taxYear);
  if (!catchUpPortionCents || !limits.rothCatchUpRequirementApplies) return false;
  if (priorYearFicaWagesCents === undefined || priorYearFicaWagesCents === null) return null;
  return priorYearFicaWagesCents > limits.rothCatchUpWageThresholdCents;
}

module.exports = {
  IRS_DEFERRAL_LIMITS,
  getDeferralLimits,
  catchUpBand,
  annualDeferralCapCents,
  rothCatchUpRequired,
};

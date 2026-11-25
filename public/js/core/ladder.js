// The autonomy ladder and its promotion gate (docs/SPEC.md section 7).
//
// Promotion is a decision that needs evidence, not a switch. The gate looks at
// every user segment, not just the overall rate: an overall rate under the
// threshold can hide one segment well over it, which is the book's MoneyGro
// case (chapter 15).

export const RUNGS = ['suggest', 'approve_each', 'bounded'];
export const RUNG_LABELS = {
  suggest: 'Suggest only',
  approve_each: 'Approve each order',
  bounded: 'Act within limits',
};
/** Rung numbers in the book's table 14.2 (rung 0, analytics only, is not part of Reins). */
export const BOOK_RUNG = { suggest: 1, approve_each: 2, bounded: 3 };

export const DEFAULT_THRESHOLD = 0.1;
export const DEFAULT_MIN_EVENTS = 50;

/** What each step up needs. The screens read these numbers from here, so they cannot disagree with the gate. */
export const STEPS = {
  suggest: { to: 'approve_each', minWeeks: 4, needsConsent: false },
  approve_each: { to: 'bounded', minWeeks: 8, needsConsent: true },
};

function rate(overrides, events) {
  return events > 0 ? overrides / events : null;
}

/**
 * @param {object} input
 * @param {string} input.from the current rung
 * @param {number} input.weeks weeks of shadow-mode evidence
 * @param {{[segment: string]: {events: number, overrides: number}}} input.segments
 * @param {boolean} [input.consent] the person's explicit consent (needed to reach `bounded`)
 * @returns {{allowed: boolean, to: string|null, failures: {code: string, segment?: string}[], overall: object, bySegment: object}}
 */
export function checkPromotion({ from, weeks, segments, consent = false, threshold = DEFAULT_THRESHOLD, minEvents = DEFAULT_MIN_EVENTS }) {
  const bySegment = {};
  let events = 0;
  let overrides = 0;
  for (const [name, s] of Object.entries(segments)) {
    bySegment[name] = { events: s.events, overrides: s.overrides, rate: rate(s.overrides, s.events) };
    events += s.events;
    overrides += s.overrides;
  }
  const overall = { events, overrides, rate: rate(overrides, events) };

  const step = Object.prototype.hasOwnProperty.call(STEPS, from) ? STEPS[from] : null;
  if (!step) return { allowed: false, to: null, failures: [{ code: 'TOP_RUNG' }], overall, bySegment };

  const failures = [];
  if (weeks < step.minWeeks) failures.push({ code: 'TOO_SHORT' });
  if (step.needsConsent && !consent) failures.push({ code: 'NO_CONSENT' });
  for (const [name, s] of Object.entries(bySegment)) {
    // A segment with too little data is reported as such and not judged on a rate that means little.
    if (s.events < minEvents) failures.push({ code: 'INSUFFICIENT_DATA', segment: name });
    else if (!(s.rate < threshold)) failures.push({ code: 'SEGMENT_OVER_THRESHOLD', segment: name });
  }
  if (overall.rate === null || !(overall.rate < threshold)) failures.push({ code: 'OVERALL_OVER_THRESHOLD' });

  const allowed = failures.length === 0;
  return { allowed, to: allowed ? step.to : null, failures, overall, bySegment };
}

// Synthetic shadow-mode data.
//
// There are no real users in this project. In shadow mode the agent proposes
// orders that a person then accepts or overrides, and the override rate by
// segment is the evidence for moving up the autonomy ladder. The events here
// are generated from a seeded random number generator (mulberry32) so a run
// can be repeated exactly. They are invented, and say nothing about real users.

export const SEGMENTS = [
  { id: 'single', label: 'Single adult', share: 0.35 },
  { id: 'couple', label: 'Couple', share: 0.25 },
  { id: 'family', label: 'Family (multi-cart)', share: 0.2 },
  { id: 'new_user', label: 'New user', share: 0.2 },
];

/** Chance that a person overrides the agent, by segment, for each synthetic data set. */
export const OVERRIDE_PROBABILITY = {
  // Looks healthy overall (about 8%) while the family segment is far over the threshold.
  hidden_gap: { single: 0.03, couple: 0.04, family: 0.26, new_user: 0.05 },
  // The same shape with the family segment fixed.
  healthy: { single: 0.03, couple: 0.04, family: 0.06, new_user: 0.05 },
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {{set: 'hidden_gap'|'healthy', seed: number, weeks: number, eventsPerWeek: number}} options
 * @returns {{week: number, segment: string, overridden: boolean}[]}
 */
export function generateShadowEvents({ set, seed, weeks, eventsPerWeek }) {
  if (!Object.prototype.hasOwnProperty.call(OVERRIDE_PROBABILITY, set)) throw new RangeError(`unknown data set: ${String(set)}`);
  const probability = OVERRIDE_PROBABILITY[set];
  const rand = mulberry32(seed);
  const events = [];
  for (let week = 1; week <= weeks; week += 1) {
    for (let i = 0; i < eventsPerWeek; i += 1) {
      const draw = rand();
      let acc = 0;
      let segment = SEGMENTS[SEGMENTS.length - 1].id;
      for (const s of SEGMENTS) {
        acc += s.share;
        if (draw < acc) { segment = s.id; break; }
      }
      events.push({ week, segment, overridden: rand() < probability[segment] });
    }
  }
  return events;
}

/** Counts per segment, the overall rate, and how many weeks the events span. */
export function summarizeEvents(events) {
  const segments = Object.fromEntries(SEGMENTS.map((s) => [s.id, { events: 0, overrides: 0 }]));
  let weeks = 0;
  let overrides = 0;
  for (const e of events) {
    segments[e.segment].events += 1;
    if (e.overridden) {
      segments[e.segment].overrides += 1;
      overrides += 1;
    }
    if (e.week > weeks) weeks = e.week;
  }
  return { weeks, segments, overall: { events: events.length, overrides, rate: events.length ? overrides / events.length : null } };
}

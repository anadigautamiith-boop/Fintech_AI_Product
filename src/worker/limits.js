// A small sliding-window rate limiter kept in memory.
//
// It is per Worker instance, so it is a speed bump and not a guarantee: a
// caller served by several instances gets several windows. The real ceiling on
// model use is the platform's free daily allowance, after which calls fail and
// the app falls back to the form and the scripted agent.

export function createLimiter({ limit, windowMs, now = Date.now, maxKeys = 5000 }) {
  const hits = new Map();
  return {
    /** @returns {{ok: true} | {ok: false, retryAfterSec: number}} */
    check(key) {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((at) => t - at < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((recent[0] + windowMs - t) / 1000)) };
      }
      recent.push(t);
      hits.set(key, recent);
      if (hits.size > maxKeys) {
        for (const [k, list] of hits) if (list.every((at) => t - at >= windowMs)) hits.delete(k);
        if (hits.size > maxKeys) hits.clear();
      }
      return { ok: true };
    },
  };
}

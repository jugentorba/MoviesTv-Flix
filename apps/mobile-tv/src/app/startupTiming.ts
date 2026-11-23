/**
 * A few coarse marks for the time between JavaScript starting and the first
 * useful frame.
 *
 * Deliberately tiny: one `Date.now()` per phase, logged once. There is no
 * numbers-in-the-UI surface yet, and a measurement that costs milliseconds to
 * collect is worth leaving in a release build so a regression is visible in the
 * device log instead of being guessed at.
 */
const jsStartedAt = Date.now();
const reported = new Set<string>();
export function startupElapsedMs(): number {
  return Date.now() - jsStartedAt;
}

export function markStartup(phase: string): number {
  const elapsed = startupElapsedMs();
  if (!reported.has(phase)) {
    reported.add(phase);
    // Plain console: React Native forwards it to the device log in release.
    console.info(`[startup] ${phase} +${elapsed}ms`);
  }
  return elapsed;
}

/** Test seam: the module clock is fixed at import time. */
export function resetStartupMarksForTests(): void {
  reported.clear();
}

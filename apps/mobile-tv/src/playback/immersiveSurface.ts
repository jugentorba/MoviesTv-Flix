import { useSyncExternalStore } from 'react';

/**
 * A tiny global flag for "a full-screen surface is on screen right now".
 *
 * The playback overlay hides the phone tab bar while a film plays, but the
 * offline player lives inside the Downloads screen, which is a different route.
 * A route cannot tell the navigator to hide its own tab bar, and threading a
 * callback through the navigator would couple two unrelated trees, so the
 * surface announces itself here instead.
 *
 * A counter rather than a boolean: two surfaces can briefly overlap while one
 * is closing and the next is mounting, and a boolean would drop the bar early.
 */
let activeCount = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Call from an effect; the returned function releases the claim. */
export function beginImmersiveSurface(): () => void {
  activeCount += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeCount = Math.max(0, activeCount - 1);
    emit();
  };
}

export function useImmersiveSurfaceActive(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => activeCount > 0,
    () => false,
  );
}

/** Test seam: never call this from a component. */
export function resetImmersiveSurfacesForTests(): void {
  activeCount = 0;
  emit();
}

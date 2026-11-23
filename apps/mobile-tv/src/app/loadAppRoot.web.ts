import { lazy } from 'react';

/**
 * Web keeps `AppRoot` in its own chunk: the boot error boundary and the PWA
 * shell stay small, and the deferred module is fetched after first paint.
 *
 * The native variant loads it synchronously — see `loadAppRoot.native.ts`.
 */
export default lazy(() => import('./AppRoot'));

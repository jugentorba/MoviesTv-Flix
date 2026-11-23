import { runtimeAddonSecretStore } from '../addons/addonSecretRuntime';
import { M3uLiveTvAdapter } from './M3uLiveTvAdapter';
import { M3uPlaylistStore } from './M3uPlaylistStore';

/**
 * One playlist store per identity.
 *
 * The Live TV screen and the settings screen must share an instance so a
 * playlist added in settings is visible to Live TV without a reload race, and
 * a subscriber in one screen sees writes made in the other.
 */
const stores = new Map<string, M3uPlaylistStore>();
const adapters = new Map<string, M3uLiveTvAdapter>();
const MAX_CACHED_IDENTITIES = 8;

function scopeFor(identity: string | null | undefined): string {
  const normalized = typeof identity === 'string' ? identity.trim() : '';
  if (!normalized) return 'guest';
  return `user-${normalized}`.slice(0, 64);
}

function forgetOldest(): void {
  if (stores.size <= MAX_CACHED_IDENTITIES) return;
  const oldest = stores.keys().next();
  if (oldest.done) return;
  stores.delete(oldest.value);
  adapters.delete(oldest.value);
}

/**
 * Native: SecureStore, keyed by identity. Web: session memory only — see
 * `addonSecretRuntime.web.ts`. Either way the playlist URL never reaches
 * preferences, the sync payload, logs or the service worker.
 */
export function m3uPlaylistStoreFor(
  identity: string | null | undefined,
): M3uPlaylistStore {
  const scope = scopeFor(identity);
  const existing = stores.get(scope);
  if (existing) return existing;
  const store = new M3uPlaylistStore(runtimeAddonSecretStore, undefined, scope);
  stores.set(scope, store);
  forgetOldest();
  return store;
}

export function m3uLiveTvAdapterFor(
  identity: string | null | undefined,
): M3uLiveTvAdapter {
  const scope = scopeFor(identity);
  const existing = adapters.get(scope);
  if (existing) return existing;
  const adapter = new M3uLiveTvAdapter(m3uPlaylistStoreFor(identity));
  adapters.set(scope, adapter);
  forgetOldest();
  return adapter;
}

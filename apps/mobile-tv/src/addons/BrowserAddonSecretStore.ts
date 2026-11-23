import type { SecureStoreAdapter } from './SecureAddonSecretStore';
import { createEphemeralAddonSecretStore } from './createAddonSecretAdapter';

/**
 * Provider credentials in the PWA are intentionally session-memory only.
 *
 * Do not persist these values to durable browser storage, service-worker
 * caches, or synced provider metadata. Reloading/closing the web
 * app deliberately requires secret provider credentials to be entered again.
 */
export const browserAddonSecretStore: SecureStoreAdapter =
  createEphemeralAddonSecretStore();

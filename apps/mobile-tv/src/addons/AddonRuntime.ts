import type { SupabaseClient } from '@supabase/supabase-js';
import type { KeyValueStore } from '@moviestv/storage';
import { AddonInstallationService } from './AddonInstallationService';
import { AddonStateCoordinator } from './AddonStateCoordinator';
import {
  AsyncStorageAddonRepository,
  addonFallbackStorageKeysForUser,
  addonStorageKeyForUser,
} from './AsyncStorageAddonRepository';
import { ManifestLoader } from './ManifestLoader';
import {
  SecureAddonSecretStore,
  addonSecretScopeForUser,
  type SecureStoreAdapter,
} from './SecureAddonSecretStore';
import { SupabaseAddonSyncGateway } from './SupabaseAddonSyncGateway';

export interface AddonRuntimeDependencies {
  metadataStore: KeyValueStore;
  secureStore: SecureStoreAdapter;
  supabase?: SupabaseClient;
  userId?: string | null;
  inheritLegacyUserData?: boolean;
}

export function createAddonRuntime({
  metadataStore,
  secureStore,
  supabase,
  userId = null,
  inheritLegacyUserData = true,
}: AddonRuntimeDependencies) {
  const repository = new AsyncStorageAddonRepository(
    metadataStore,
    addonStorageKeyForUser(userId),
    inheritLegacyUserData ? addonFallbackStorageKeysForUser(userId) : [],
  );
  const secretScope = addonSecretScopeForUser(userId);
  const secrets = new SecureAddonSecretStore(
    secureStore,
    secretScope,
    inheritLegacyUserData && userId ? [addonSecretScopeForUser(null)] : [],
    inheritLegacyUserData,
  );
  const manifestLoader = new ManifestLoader();
  const service = new AddonInstallationService(repository, secrets, manifestLoader);
  const cloud = supabase ? new SupabaseAddonSyncGateway(supabase) : undefined;
  const coordinator = new AddonStateCoordinator(repository, secrets, cloud);

  return {
    repository,
    secrets,
    manifestLoader,
    service,
    coordinator,
  };
}

import type { SecureStoreAdapter } from './SecureAddonSecretStore';

export function createEphemeralAddonSecretStore(): SecureStoreAdapter {
  const values = new Map<string, string>();
  return {
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => { values.set(key, value); },
    deleteItemAsync: async (key) => { values.delete(key); },
  };
}

export function createAddonSecretAdapter(
  platform: string,
  nativeStore: SecureStoreAdapter,
): SecureStoreAdapter {
  return platform === 'web' ? createEphemeralAddonSecretStore() : nativeStore;
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SecureStoreAdapter } from './SecureAddonSecretStore';

/**
 * Durable provider secrets for the packaged desktop app.
 *
 * The browser PWA keeps provider credentials in memory on purpose: a page can
 * be reloaded, cached or replayed by any script on the origin, and an add-on URL
 * can carry a debrid key. The macOS build is different — it is a single-user app
 * whose web bundle is served from `127.0.0.1` inside its own container, and it
 * has no "reload" that loses the page. Without persistence a configured provider
 * had to be re-entered on every launch, which made the desktop app unusable with
 * real add-ons.
 *
 * Nothing here is ever synchronized: the values live under a desktop-only key
 * prefix on this machine and never enter a preference or add-on sync payload.
 */
export const DESKTOP_SECRET_KEY_PREFIX = 'mtflix.desktop.addon-secret.';

export function isDesktopHost(): boolean {
  if (typeof window === 'undefined') return false;
  const flag = (window as { __MOVIESTV_DESKTOP__?: unknown }).__MOVIESTV_DESKTOP__;
  return Boolean(flag);
}

export function createDesktopAddonSecretStore(): SecureStoreAdapter {
  return {
    getItemAsync: async (key) => AsyncStorage.getItem(DESKTOP_SECRET_KEY_PREFIX + key),
    setItemAsync: async (key, value) => {
      await AsyncStorage.setItem(DESKTOP_SECRET_KEY_PREFIX + key, value);
    },
    deleteItemAsync: async (key) => {
      await AsyncStorage.removeItem(DESKTOP_SECRET_KEY_PREFIX + key);
    },
  };
}

/**
 * Picks the store for the current host. Injected by `apps/desktop-mac`, so the
 * browser build keeps the memory-only rule even though both run the same bundle.
 */
export function createHostAwareAddonSecretStore(
  browserStore: SecureStoreAdapter,
): SecureStoreAdapter {
  return isDesktopHost() ? createDesktopAddonSecretStore() : browserStore;
}

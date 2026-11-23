import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DESKTOP_SECRET_KEY_PREFIX,
  createDesktopAddonSecretStore,
  createHostAwareAddonSecretStore,
  isDesktopHost,
} from '../DesktopAddonSecretStore';
import type { SecureStoreAdapter } from '../SecureAddonSecretStore';

const browserStore: SecureStoreAdapter = {
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
};

describe('desktop add-on secrets', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    delete (globalThis as { window?: unknown }).window;
  });

  it('is not the desktop host in a plain browser', () => {
    (globalThis as { window?: unknown }).window = {};
    expect(isDesktopHost()).toBe(false);
    expect(createHostAwareAddonSecretStore(browserStore)).toBe(browserStore);
  });

  it('persists values under a desktop-only prefix when the host flag is set', async () => {
    (globalThis as { window?: unknown }).window = {
      __MOVIESTV_DESKTOP__: { platform: 'macos' },
    };
    const store = createHostAwareAddonSecretStore(browserStore);

    await store.setItemAsync('comet:manifest', 'https://example.test/config/manifest.json');

    expect(await AsyncStorage.getItem(
      `${DESKTOP_SECRET_KEY_PREFIX}comet:manifest`,
    )).toBe('https://example.test/config/manifest.json');
    expect(await store.getItemAsync('comet:manifest'))
      .toBe('https://example.test/config/manifest.json');

    await store.deleteItemAsync('comet:manifest');
    expect(await store.getItemAsync('comet:manifest')).toBeNull();
    expect(browserStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('creates a working store directly', async () => {
    const store = createDesktopAddonSecretStore();
    await store.setItemAsync('torrentio', 'value');
    expect(await store.getItemAsync('torrentio')).toBe('value');
  });
});

import type { SecureStoreAdapter } from '../SecureAddonSecretStore';
import { createAddonSecretAdapter } from '../createAddonSecretAdapter';

function memoryNative(): SecureStoreAdapter {
  const values = new Map<string, string>();
  return {
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => { values.set(key, value); },
    deleteItemAsync: async (key) => { values.delete(key); },
  };
}

test('native platforms use the supplied secure store', () => {
  const native = memoryNative();
  expect(createAddonSecretAdapter('ios', native)).toBe(native);
});

test('web secrets stay in memory and never touch native storage', async () => {
  const native: SecureStoreAdapter = {
    getItemAsync: jest.fn(async () => null),
    setItemAsync: jest.fn(async () => undefined),
    deleteItemAsync: jest.fn(async () => undefined),
  };
  const web = createAddonSecretAdapter('web', native);

  await web.setItemAsync('token', 'secret');
  expect(await web.getItemAsync('token')).toBe('secret');
  await web.deleteItemAsync('token');
  expect(await web.getItemAsync('token')).toBeNull();

  expect(native.setItemAsync).not.toHaveBeenCalled();
  expect(native.getItemAsync).not.toHaveBeenCalled();
  expect(native.deleteItemAsync).not.toHaveBeenCalled();
});

test('separate web adapter instances do not persist values', async () => {
  const native = memoryNative();
  const first = createAddonSecretAdapter('web', native);
  await first.setItemAsync('token', 'secret');

  const second = createAddonSecretAdapter('web', native);
  expect(await second.getItemAsync('token')).toBeNull();
});

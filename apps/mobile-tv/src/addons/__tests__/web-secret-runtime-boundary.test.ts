import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runtimeAddonSecretStore } from '../addonSecretRuntime.web';

test('AppRoot does not statically import expo-secure-store', () => {
  const source = readFileSync(resolve(__dirname, '../../app/AppRoot.tsx'), 'utf8');
  expect(source).not.toContain("from 'expo-secure-store'");
});

test('web runtime addon secret fallback supports the secure-store contract', async () => {
  await runtimeAddonSecretStore.setItemAsync('token', 'secret');
  expect(await runtimeAddonSecretStore.getItemAsync('token')).toBe('secret');
  await runtimeAddonSecretStore.deleteItemAsync('token');
  expect(await runtimeAddonSecretStore.getItemAsync('token')).toBeNull();
});


test('web addon secret runtime never references persistent browser storage', () => {
  const runtimeSource = readFileSync(
    resolve(__dirname, '../addonSecretRuntime.web.ts'),
    'utf8',
  );
  const storeSource = readFileSync(
    resolve(__dirname, '../BrowserAddonSecretStore.ts'),
    'utf8',
  );
  const source = `${runtimeSource}\n${storeSource}`;

  expect(source).not.toMatch(/\bindexedDB\b/);
  expect(source).not.toMatch(/\blocalStorage\b/);
  expect(source).not.toMatch(/\bsessionStorage\b/);
  expect(source).not.toContain('moviestv-flix-secrets');
});

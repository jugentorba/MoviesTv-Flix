import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { browserAddonSecretStore } from '../BrowserAddonSecretStore';

test('browser provider secrets stay usable only in the current runtime memory', async () => {
  await browserAddonSecretStore.setItemAsync(
    'test:provider-token',
    'runtime-secret',
  );

  expect(
    await browserAddonSecretStore.getItemAsync('test:provider-token'),
  ).toBe('runtime-secret');

  await browserAddonSecretStore.deleteItemAsync('test:provider-token');
  expect(
    await browserAddonSecretStore.getItemAsync('test:provider-token'),
  ).toBeNull();
});

test('browser provider secret store has no durable browser-storage dependency', () => {
  const source = readFileSync(
    resolve(__dirname, '../BrowserAddonSecretStore.ts'),
    'utf8',
  );

  expect(source).not.toMatch(/\bindexedDB\b/);
  expect(source).not.toMatch(/\blocalStorage\b/);
  expect(source).not.toMatch(/\bsessionStorage\b/);
  expect(source).not.toContain('moviestv-flix-secrets');
});

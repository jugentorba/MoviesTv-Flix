import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('reads Expo public environment variables through statically inlineable access', () => {
  const source = readFileSync(resolve(__dirname, '../app/AppRoot.tsx'), 'utf8');

  expect(source).toContain('process.env.EXPO_PUBLIC_PREVIEW_MODE');
  expect(source).toContain('process.env.EXPO_PUBLIC_SUPABASE_URL');
  expect(source).toContain('process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  expect(source).not.toContain('globalThis as { process?');
});

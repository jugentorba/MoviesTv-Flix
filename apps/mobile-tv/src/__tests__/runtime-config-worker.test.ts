import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('Cloudflare runtime config exposes public auth config only', () => {
  const source = readFileSync(
    resolve(__dirname, '../../../../worker/index.js'),
    'utf8',
  );

  expect(source).toContain("'/api/runtime-config'");
  expect(source).toContain("'/api/app-update/manifest'");
  expect(source).toContain("'MoviesTv-Flix-phone-preview.apk'");
  expect(source).toContain('GITHUB_RELEASE_TOKEN');
  expect(source).toContain('EXPO_PUBLIC_SUPABASE_URL');
  expect(source).toContain('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  expect(source).not.toContain('env.SUPABASE_SERVICE_ROLE');
  expect(source).toContain('/^sb_secret_/i');
  expect(source).toContain("payload?.role !== 'anon'");
});


test('Cloudflare Pages API compatibility reuses the Worker runtime routes', () => {
  const functionSource = readFileSync(
    resolve(__dirname, '../../../../functions/api/[[path]].js'),
    'utf8',
  );
  const routes = JSON.parse(
    readFileSync(
      resolve(__dirname, '../../public/_routes.json'),
      'utf8',
    ),
  ) as { version: number; include: string[] };

  expect(functionSource).toContain("import worker from '../../worker/index.js'");
  expect(functionSource).toContain("pathname === '/api/runtime-config'");
  expect(functionSource).toContain("pathname.startsWith('/api/app-update/')");
  expect(functionSource).toContain("pathname.startsWith('/api/cinemeta/')");
  expect(functionSource).toContain("pathname.startsWith('/api/nuvio-catalog/')");
  expect(functionSource).toContain('return worker.fetch(context.request, context.env)');
  expect(routes).toEqual({
    version: 1,
    include: ['/api/*'],
    exclude: [],
  });
});

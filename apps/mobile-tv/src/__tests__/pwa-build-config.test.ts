import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('PWA production build runs platform-safe source checks before export', () => {
  const pkg = JSON.parse(
    readFileSync(resolve(__dirname, '../../../../package.json'), 'utf8'),
  ) as { scripts?: Record<string, string> };

  const build = pkg.scripts?.['build:pwa'] ?? '';
  const checkScript = pkg.scripts?.['check:pwa'] ?? '';
  const check = build.indexOf('pnpm check:pwa');
  const playbackTypecheck = build.indexOf(
    'tsc --noEmit -p tsconfig.playback.json',
  );
  const exportWeb = build.indexOf('export:web');
  const verifyWeb = build.indexOf('verify:web');

  expect(check).toBeGreaterThan(-1);
  expect(checkScript).toContain('pnpm lint');
  expect(checkScript).toContain('pnpm test');
  expect(checkScript).not.toContain('pnpm typecheck');
  expect(playbackTypecheck).toBeGreaterThan(check);
  expect(exportWeb).toBeGreaterThan(playbackTypecheck);
  expect(verifyWeb).toBeGreaterThan(exportWeb);
});


test('PWA TypeScript gate covers the web app instead of one playback file', () => {
  const config = JSON.parse(
    readFileSync(
      resolve(__dirname, '../../tsconfig.playback.json'),
      'utf8',
    ),
  ) as {
    compilerOptions?: { moduleSuffixes?: string[] };
    include?: string[];
    exclude?: string[];
  };

  expect(config.compilerOptions?.moduleSuffixes).toEqual(['.web', '']);
  expect(config.include).toEqual(expect.arrayContaining([
    'App.tsx',
    'src/**/*.ts',
    'src/**/*.tsx',
  ]));
  expect(config.exclude).toEqual(expect.arrayContaining([
    'src/**/*.native.ts',
    'src/**/*.native.tsx',
    'src/**/__tests__/**',
  ]));
  expect(config.include).not.toEqual([
    'src/playback/VideoSurface.web.tsx',
  ]);
});


test('PWA source gate does not rely on a duplicate typecheck probe', () => {
  expect(
    existsSync(
      resolve(
        __dirname,
        '../playback/VideoSurface.typecheck.tsx',
      ),
    ),
  ).toBe(false);
});


test('web media elements rely on lifecycle-aware explicit playback', () => {
  const movie = readFileSync(
    resolve(__dirname, '../playback/VideoSurface.web.tsx'),
    'utf8',
  );
  const liveTv = readFileSync(
    resolve(__dirname, '../live-tv/LiveTvVideoSurface.web.tsx'),
    'utf8',
  );

  expect(movie).toContain('autoPlay: false');
  expect(liveTv).toContain('autoPlay: false');
  expect(movie).toContain('shouldAttemptWebPlayback');
  expect(liveTv).toContain('shouldAttemptWebPlayback');
  expect(liveTv).toContain('pauseWebMediaForBackground');
  expect(liveTv).toContain('attached.pauseNetwork?.()');
  expect(liveTv).toContain('attached.resumeNetwork?.()');
  expect(liveTv).toContain("window.addEventListener('pagehide'");
});


test('preview diagnostics stay gated behind preview mode', () => {
  const settings = readFileSync(
    resolve(__dirname, '../screens/SettingsScreen.tsx'),
    'utf8',
  );
  const diagnostics = readFileSync(
    resolve(__dirname, '../screens/PreviewDiagnosticsScreen.tsx'),
    'utf8',
  );

  expect(settings).toContain("process.env.EXPO_PUBLIC_PREVIEW_MODE === '1'");
  expect(settings).toContain('settings-preview-diagnostics');
  expect(diagnostics).toContain('/manifest.webmanifest');
  expect(diagnostics).toContain('/service-worker.js');
  expect(diagnostics).toContain('/api/runtime-config');
  expect(diagnostics).toContain('/api/nuvio-catalog/manifest.json');
  expect(diagnostics).toContain('/api/cinemeta/manifest.json');
  expect(diagnostics).toContain('moviestv-shell-');
  expect(diagnostics).toContain('PWA build');
  expect(diagnostics).toContain(
    'No provider keys or private URLs are displayed.',
  );
});

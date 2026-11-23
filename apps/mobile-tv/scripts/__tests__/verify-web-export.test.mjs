import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const verifier = fileURLToPath(new URL('../verify-web-export.mjs', import.meta.url));

function pngHeader(width, height) {
  const buffer = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'moviestv-web-'));
  mkdirSync(join(root, 'assets'), { recursive: true });
  mkdirSync(join(root, 'updates'), { recursive: true });
  writeFileSync(
    join(root, 'index.html'),
    '<!doctype html><html><head><meta name="moviestv-build-id" content="0123456789abcdef"></head><body><script src="/assets/app.js"></script></body></html>',
  );
  writeFileSync(join(root, 'manifest.webmanifest'), JSON.stringify({
    id: '/',
    name: 'MoviesTv-Flix',
    short_name: 'MoviesTv-Flix',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#09090b',
    theme_color: '#09090b',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable',
      },
    ],
  }));
  writeFileSync(
    join(root, 'service-worker.js'),
    [
      "const CACHE = 'moviestv-shell-0123456789abcdef';",
      "const paths = ['/api/', '/auth/', '/rest/', '/realtime/', '/storage/', '/functions/'];",
      'const shell = ["/assets/app.js"];',
      'function sensitiveQuery() { return false; }',
      'function sensitiveHeaders() { return false; }',
      'function responseUrlMayBeCached() { return true; }',
      'function responseMayBeCached() { return true; }',
      'function navigationResponseMayBeCached() { return true; }',
      'function staticAssetResponseMayBeCached() { return true; }',
      "function route(request) { return request.mode === 'navigate' ? caches.match('/') : null; }",
      'self.addEventListener("fetch", () => {});',
    ].join('\n'),
  );
  writeFileSync(
    join(root, '_headers'),
    [
      '/*',
      '  X-Content-Type-Options: nosniff',
      '  X-Frame-Options: DENY',
      '  Referrer-Policy: strict-origin-when-cross-origin',
      '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
      '',
      '/service-worker.js',
      '  Cache-Control: no-cache',
      '',
      '/manifest.webmanifest',
      '  Cache-Control: no-cache',
      '',
      '/icon-192.png',
      '  Cache-Control: no-cache',
      '',
      '/icon-512.png',
      '  Cache-Control: no-cache',
      '',
      '/updates/latest.json',
      '  Cache-Control: no-store, max-age=0',
      '',
      '/updates/index.html',
      '  Cache-Control: no-cache',
      '',
      '/updates/',
      '  Cache-Control: no-cache',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(root, '_routes.json'),
    JSON.stringify({ version: 1, include: ['/api/*'], exclude: [] }),
  );
  writeFileSync(
    join(root, 'updates', 'index.html'),
    '<!doctype html><title>Updates</title><script>fetch("/api/app-update/manifest")</script>',
  );
  writeFileSync(
    join(root, 'updates', 'latest.json'),
    JSON.stringify({ schemaVersion: 1, channel: 'preview' }),
  );
  writeFileSync(join(root, 'icon-192.png'), pngHeader(192, 192));
  writeFileSync(join(root, 'icon-512.png'), pngHeader(512, 512));
  writeFileSync(
    join(root, 'assets', 'app.js'),
    [
      'console.log("safe");',
      'const sw = "/service-worker.js";',
      'const manifest = "/manifest.webmanifest";',
      'window.addEventListener("beforeinstallprompt", () => {});',
      'window.addEventListener("appinstalled", () => {});',
      'const iosPwa = "apple-touch-icon apple-mobile-web-app-capable apple-mobile-web-app-status-bar-style apple-mobile-web-app-title viewport-fit=cover";',
    ].join('\n'),
  );
  return root;
}

function verify(root) {
  return spawnSync(process.execPath, [verifier, root], { encoding: 'utf8' });
}

function run(name, body) {
  const root = fixture();
  try {
    body(root);
    console.log(`PASS ${name}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

run('accepts a complete safe static export', (root) => {
  const result = verify(root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

run('accepts the shipped release page using the live update gateway', (root) => {
  writeFileSync(
    join(root, 'updates', 'index.html'),
    readFileSync(new URL('../../public/updates/index.html', import.meta.url), 'utf8'),
  );
  const result = verify(root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

run('rejects a release page without the live manifest fetch', (root) => {
  for (const script of [
    'fetch("./latest.json")',
    'const endpoint = "/api/app-update/manifest";',
    'fetch("/api/app-update/manifest-wrong")',
  ]) {
    writeFileSync(
      join(root, 'updates', 'index.html'),
      `<!doctype html><title>Updates</title><script>${script}</script>`,
    );
    const result = verify(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr || result.stdout, /must load the native update manifest/);
  }
});

run('rejects an export without a running-page build id', (root) => {
  const indexPath = join(root, 'index.html');
  writeFileSync(
    indexPath,
    readFileSync(indexPath, 'utf8').replace(
      /<meta name="moviestv-build-id" content="[a-f0-9]{16}">/i,
      '',
    ),
  );

  const result = verify(root);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr || result.stdout,
    /missing the stamped MoviesTv-Flix build id/i,
  );
});

run('rejects a PWA page/worker build-id mismatch', (root) => {
  const indexPath = join(root, 'index.html');
  writeFileSync(
    indexPath,
    readFileSync(indexPath, 'utf8').replace(
      '0123456789abcdef',
      'fedcba9876543210',
    ),
  );

  const result = verify(root);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr || result.stdout,
    /build id does not match/i,
  );
});

run('rejects a missing manifest', (root) => {
  unlinkSync(join(root, 'manifest.webmanifest'));
  assert.notEqual(verify(root).status, 0);
});

run('rejects a manifest without a stable app identity', (root) => {
  const manifestPath = join(root, 'manifest.webmanifest');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  delete manifest.id;
  writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.notEqual(verify(root).status, 0);
});


run('rejects incomplete installable manifest metadata', (root) => {
  const manifestPath = join(root, 'manifest.webmanifest');
  const original = JSON.parse(readFileSync(manifestPath, 'utf8'));

  for (const [field, value] of [
    ['background_color', '#ffffff'],
    ['theme_color', '#ffffff'],
  ]) {
    const manifest = { ...original, [field]: value };
    writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.notEqual(
      verify(root).status,
      0,
      `${field} mismatch was accepted`,
    );
  }

  writeFileSync(manifestPath, JSON.stringify({
    ...original,
    icons: original.icons.map((icon) => {
      const rest = { ...icon };
      delete rest.purpose;
      return rest;
    }),
  }));
  assert.notEqual(
    verify(root).status,
    0,
    'manifest without a maskable icon was accepted',
  );
});

run('rejects manifest icons whose PNG dimensions do not match their declared sizes', (root) => {
  writeFileSync(join(root, 'icon-192.png'), pngHeader(191, 192));
  assert.notEqual(
    verify(root).status,
    0,
    'wrong-size 192x192 icon was accepted',
  );
});

run('rejects manifest icon paths that escape the static export root', (root) => {
  const manifestPath = join(root, 'manifest.webmanifest');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.icons[0].src = '/../icon-192.png';
  writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.notEqual(verify(root).status, 0);
});

run('rejects a manifest whose launch URL or scope escapes the app root', (root) => {
  const manifestPath = join(root, 'manifest.webmanifest');
  for (const field of ['start_url', 'scope']) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest[field] = '/other';
    writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.notEqual(verify(root).status, 0, `${field} outside root was accepted`);
    manifest[field] = '/';
    writeFileSync(manifestPath, JSON.stringify(manifest));
  }
});

run('rejects a top-level 404 that disables Pages SPA fallback', (root) => {
  writeFileSync(join(root, '404.html'), '<!doctype html><h1>Not found</h1>');
  assert.notEqual(verify(root).status, 0);
});

run('rejects missing Cloudflare cache headers', (root) => {
  unlinkSync(join(root, '_headers'));
  assert.notEqual(verify(root).status, 0);
});

run('rejects missing baseline PWA security headers', (root) => {
  const headersPath = join(root, '_headers');
  const safeHeaders = readFileSync(headersPath, 'utf8');

  for (const header of [
    'X-Content-Type-Options: nosniff',
    'X-Frame-Options: DENY',
    'Referrer-Policy: strict-origin-when-cross-origin',
    'Permissions-Policy: camera=(), microphone=(), geolocation=()',
  ]) {
    writeFileSync(headersPath, safeHeaders.replace(`  ${header}\n`, ''));
    assert.notEqual(verify(root).status, 0, `${header} was optional`);
    writeFileSync(headersPath, safeHeaders);
  }
});

run('rejects cacheable PWA update metadata', (root) => {
  const headersPath = join(root, '_headers');
  const safeHeaders = readFileSync(headersPath, 'utf8');

  for (const route of [
    '/service-worker.js',
    '/manifest.webmanifest',
    '/icon-192.png',
    '/icon-512.png',
  ]) {
    const unsafeHeaders = safeHeaders.replace(
      `${route}\n  Cache-Control: no-cache`,
      `${route}\n  Cache-Control: public, max-age=86400`,
    );
    writeFileSync(headersPath, unsafeHeaders);
    assert.notEqual(verify(root).status, 0, `${route} was allowed to be cacheable`);
    writeFileSync(headersPath, safeHeaders);
  }
});

run('rejects missing Pages API routing', (root) => {
  unlinkSync(join(root, '_routes.json'));
  assert.notEqual(verify(root).status, 0);
});

run('rejects Pages routing that omits API functions', (root) => {
  writeFileSync(
    join(root, '_routes.json'),
    JSON.stringify({ version: 1, include: ['/other/*'], exclude: [] }),
  );
  assert.notEqual(verify(root).status, 0);
});

run('rejects Pages routing that excludes API functions', (root) => {
  writeFileSync(
    join(root, '_routes.json'),
    JSON.stringify({
      version: 1,
      include: ['/api/*'],
      exclude: ['/api/*'],
    }),
  );
  assert.notEqual(verify(root).status, 0);
});

run('rejects signing and provisioning artifacts from the static export', (root) => {
  for (const filename of [
    'signing.p12',
    'signing.pfx',
    'android.keystore',
    'upload.jks',
    'embedded.mobileprovision',
  ]) {
    writeFileSync(join(root, filename), Buffer.from([0, 1, 2, 3, 4]));
    assert.notEqual(
      verify(root).status,
      0,
      `${filename} was accepted in the public export`,
    );
    unlinkSync(join(root, filename));
  }
});

run('rejects Pages routing that excludes an API subroute', (root) => {
  writeFileSync(
    join(root, '_routes.json'),
    JSON.stringify({
      version: 1,
      include: ['/api/*'],
      exclude: ['/api/runtime-config'],
    }),
  );
  assert.notEqual(verify(root).status, 0);
});

run('rejects a service-role/private secret marker', (root) => {
  writeFileSync(join(root, 'assets', 'app.js'), 'const key = "SUPABASE_SERVICE_ROLE_KEY";');
  assert.notEqual(verify(root).status, 0);
});

run('rejects RSA private key material', (root) => {
  writeFileSync(
    join(root, 'assets', 'app.js'),
    'const key = "-----BEGIN RSA PRIVATE KEY-----";',
  );
  assert.notEqual(verify(root).status, 0);
});

run('rejects private key material in credential files', (root) => {
  for (const kind of ['EC', 'OPENSSH']) {
    writeFileSync(
      join(root, 'signing.pem'),
      `-----BEGIN ${kind} PRIVATE KEY-----\nsecret\n-----END ${kind} PRIVATE KEY-----`,
    );
    assert.notEqual(verify(root).status, 0, `${kind} private key was accepted`);
  }
});

run('rejects a Supabase secret key value', (root) => {
  writeFileSync(
    join(root, 'assets', 'app.js'),
    'const key = "sb_secret_1234567890abcdefghijklmnop";',
  );
  assert.notEqual(verify(root).status, 0);
});

run('rejects a legacy Supabase service-role JWT', (root) => {
  const encode = (value) => Buffer
    .from(JSON.stringify(value))
    .toString('base64url');
  const jwt = [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode({ role: 'service_role', iss: 'supabase' }),
    'signature',
  ].join('.');

  writeFileSync(
    join(root, 'assets', 'app.js'),
    `const key = "${jwt}";`,
  );

  assert.notEqual(verify(root).status, 0);
});

run('rejects a privileged non-anon Supabase JWT', (root) => {
  const encode = (value) => Buffer
    .from(JSON.stringify(value))
    .toString('base64url');
  const jwt = [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode({ role: 'supabase_admin', iss: 'supabase' }),
    'signature',
  ].join('.');

  writeFileSync(
    join(root, 'assets', 'app.js'),
    `const key = "${jwt}";`,
  );

  assert.notEqual(verify(root).status, 0);
});

run('allows a public anon JWT payload', (root) => {
  const encode = (value) => Buffer
    .from(JSON.stringify(value))
    .toString('base64url');
  const jwt = [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode({ role: 'anon', iss: 'supabase' }),
    'signature',
  ].join('.');

  writeFileSync(
    join(root, 'assets', 'app.js'),
    [
      `const key = "${jwt}";`,
      'const sw = "/service-worker.js";',
      'const manifest = "/manifest.webmanifest";',
      'window.addEventListener("beforeinstallprompt", () => {});',
      'window.addEventListener("appinstalled", () => {});',
      'const iosPwa = "apple-touch-icon apple-mobile-web-app-capable apple-mobile-web-app-status-bar-style apple-mobile-web-app-title viewport-fit=cover";',
    ].join('\n'),
  );

  const result = verify(root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

run('rejects a credentialized URL value', (root) => {
  writeFileSync(
    join(root, 'assets', 'app.js'),
    'const url = "https://provider.example/manifest.json?token=1234567890abcdef";',
  );
  assert.notEqual(verify(root).status, 0);
});

run('rejects common credentialized and resolved URL forms', (root) => {
  const unsafeUrls = [
    'https://user:password@provider.example/manifest.json',
    'https://provider.example/manifest.json?access_token=x',
    'https://provider.example/manifest.json?key=LOCAL-SECRET',
    'https://provider.example/manifest.json#signature=1234',
    'https://provider.example/alldebrid=SHORT-LOCAL-SECRET/manifest.json',
    'https://provider.example/realdebrid=SHORT-LOCAL-SECRET/manifest.json',
    'https://provider.example/eyJhbGciOiJIUzI1NiJ9abcdef/manifest.json',
    'https://cdn.example/live.m3u8',
    'https://cdn.example/movie.mov',
    'https://cdn.example/movie.m4v',
    'https://cdn.example/movie.avi',
    'https://cdn.example/movie.flv',
    'https://cdn.example/movie.wmv',
    'https://cdn.example/live.ts',
  ];

  for (const url of unsafeUrls) {
    writeFileSync(join(root, 'assets', 'app.js'), `const value = "${url}";`);
    assert.notEqual(verify(root).status, 0, `${url} was accepted`);
  }
});

run('allows defensive secret-name patterns without embedded values', (root) => {
  appendFileSync(
    join(root, 'assets', 'app.js'),
    'const secretGuard = /^sb_secret_/i; const roleGuard = /service[-_]?role/i;',
  );
  const result = verify(root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});


run('allows Cloudflare hostnames that begin with main.mov', (root) => {
  const js = join(root, 'bundle.js');
  writeFileSync(
    js,
    'const updateUrl = "https://main.moviestv-flix.pages.dev/api/app-update/manifest";',
  );

  const result = verify(root);
  assert.equal(
    result.status,
    0,
    result.stderr || result.stdout,
  );
});

run('rejects a resolved stream URL marker', (root) => {
  writeFileSync(join(root, 'assets', 'app.js'), 'const stream = "https://secret-stream.invalid/live.m3u8";');
  assert.notEqual(verify(root).status, 0);
});

run('rejects service workers that omit exported entry assets from the shell cache', (root) => {
  const workerPath = join(root, 'service-worker.js');
  const safeWorker = readFileSync(workerPath, 'utf8');
  writeFileSync(
    workerPath,
    safeWorker.replace('"/assets/app.js"', '"/assets/missing.js"'),
  );

  assert.notEqual(verify(root).status, 0);
});

run('rejects service workers missing sensitive-header or response cache guards', (root) => {
  const workerPath = join(root, 'service-worker.js');
  const safeWorker = readFileSync(workerPath, 'utf8');

  for (const guard of [
    'sensitiveHeaders',
    'responseUrlMayBeCached',
    'responseMayBeCached',
    'navigationResponseMayBeCached',
    'staticAssetResponseMayBeCached',
  ]) {
    writeFileSync(workerPath, safeWorker.replace(guard, 'missingGuard'));
    assert.notEqual(
      verify(root).status,
      0,
      `${guard} was optional`,
    );
    writeFileSync(workerPath, safeWorker);
  }
});

run('rejects service workers missing Supabase network-only route guards', (root) => {
  const workerPath = join(root, 'service-worker.js');
  const safeWorker = readFileSync(workerPath, 'utf8');

  for (const guard of ["'/rest/'", "'/realtime/'"]) {
    writeFileSync(workerPath, safeWorker.replace(guard, "''"));
    assert.notEqual(verify(root).status, 0, `${guard} guard was optional`);
    writeFileSync(workerPath, safeWorker);
  }
});

run('rejects an unstamped service-worker cache placeholder', (root) => {
  writeFileSync(
    join(root, 'service-worker.js'),
    "const CACHE = 'moviestv-shell-__MOVIESTV_BUILD_ID__';",
  );
  assert.notEqual(verify(root).status, 0);
});


run('rejects exports missing browser install lifecycle markers', (root) => {
  const bundlePath = join(root, 'assets', 'app.js');
  const safeBundle = readFileSync(bundlePath, 'utf8');

  for (const marker of [
    '/service-worker.js',
    '/manifest.webmanifest',
    'beforeinstallprompt',
    'appinstalled',
    'apple-touch-icon',
    'apple-mobile-web-app-capable',
    'apple-mobile-web-app-status-bar-style',
    'apple-mobile-web-app-title',
    'viewport-fit=cover',
  ]) {
    writeFileSync(bundlePath, safeBundle.replace(marker, 'missing-marker'));
    assert.notEqual(
      verify(root).status,
      0,
      `${marker} was optional in exported JavaScript`,
    );
    writeFileSync(bundlePath, safeBundle);
  }
});


run('rejects the retired persistent browser secret-vault marker', (root) => {
  writeFileSync(
    join(root, 'assets', 'app.js'),
    'const database = "moviestv-flix-secrets";',
  );
  assert.notEqual(verify(root).status, 0);
});


run('rejects an Android update package without the trusted signer', (root) => {
  const manifestPath = join(root, 'updates', 'latest.json');
  writeFileSync(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      channel: 'preview',
      android: {
        version: '0.2.0',
        build: 20,
        downloadUrl: 'https://downloads.example/phone.apk',
        sha256: 'A'.repeat(64),
        packageName: 'com.jugentorba.moviestvflix',
        signingCertificateSha256: 'F'.repeat(64),
      },
    }),
  );

  const result = verify(root);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr || result.stdout,
    /trusted Android signing certificate/i,
  );
});

run('rejects a published package without a SHA-256', (root) => {
  const manifestPath = join(root, 'updates', 'latest.json');
  writeFileSync(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      channel: 'preview',
      ios: {
        version: '0.2.0',
        build: 21,
        downloadUrl: 'https://downloads.example/phone.ipa',
        bundleIdentifier: 'com.jugentorba.moviestvflix',
        resignable: true,
      },
    }),
  );

  const result = verify(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr || result.stdout, /sha256 is required/i);
});

run('accepts a signed HTTPS Android update package', (root) => {
  const manifestPath = join(root, 'updates', 'latest.json');
  writeFileSync(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      channel: 'preview',
      android: {
        version: '0.2.0',
        build: 22,
        downloadUrl: 'https://downloads.example/phone.apk',
        sha256: 'A'.repeat(64),
        packageName: 'com.jugentorba.moviestvflix',
        signingCertificateSha256:
          '0FD5A50BBEE30D1D3BBC7F1B5DDEE351A70C0F7BDA7F99EA17590F9311422D1D',
      },
    }),
  );

  const result = verify(root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});


run('rejects an Android update for another package', (root) => {
  const manifestPath = join(root, 'updates', 'latest.json');
  writeFileSync(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      channel: 'preview',
      android: {
        version: '0.2.0',
        build: 24,
        packageName: 'com.example.other',
        signingCertificateSha256:
          '0FD5A50BBEE30D1D3BBC7F1B5DDEE351A70C0F7BDA7F99EA17590F9311422D1D',
      },
    }),
  );

  const result = verify(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr || result.stdout, /Android package/i);
});

run('rejects an Apple update for another bundle', (root) => {
  const manifestPath = join(root, 'updates', 'latest.json');
  writeFileSync(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      channel: 'preview',
      ios: {
        version: '0.2.0',
        build: 25,
        bundleIdentifier: 'com.example.other',
        resignable: true,
      },
    }),
  );

  const result = verify(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr || result.stdout, /Apple bundle/i);
});

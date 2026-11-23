import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] ?? 'dist');
const requiredFiles = ['index.html', 'manifest.webmanifest', 'service-worker.js', '_headers', '_routes.json', 'updates/latest.json', 'updates/index.html'];
const forbiddenPatterns = [
  { label: 'SUPABASE_SERVICE_ROLE_KEY', pattern: /SUPABASE_SERVICE_ROLE_KEY/ },
  {
    label: 'private key material',
    pattern: /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/,
  },
  { label: 'APPLE_TEAM_ID', pattern: /APPLE_TEAM_ID/ },
  { label: 'Supabase secret key', pattern: /sb_secret_[A-Za-z0-9_-]{20,}/i },
  {
    label: 'URL userinfo credentials',
    pattern: /https?:\/\/[^/"'\s:@]+:[^@/"'\s]+@[^/"'\s]+/i,
  },
  {
    label: 'credentialized URL',
    pattern: /https?:\/\/[^"'\s]+[?&#](?:access[-_]?token|auth[-_]?token|api[-_]?key|apikey|key|token|password|passwd|secret|signature|sig|credential|debrid)=[^&#"'\s]+/i,
  },
  {
    label: 'credentialized provider path',
    pattern: /https?:\/\/[^/"'\s]+\/(?:[^/"'\s?#]+\/)*(?:access[-_]?token|auth[-_]?token|api[-_]?key|apikey|token|password|passwd|secret|credential|debrid|alldebrid|realdebrid)=[^/"'\s?#]+(?:\/|[?#])/i,
  },
  {
    label: 'configured provider URL',
    pattern: /https?:\/\/[^/"'\s]+(?:\/[^/"'\s?#]+)*\/[A-Za-z0-9_-]{24,}\/manifest\.json(?:[?#][^"'\s]*)?/i,
  },
  {
    label: 'resolved media URL',
    pattern: /https?:\/\/[^"'\s?#]+\.(?:m3u8|mpd|mp4|m4v|mov|mkv|webm|avi|flv|wmv|ts|mpeg|mpg)(?=[?#"'\s]|$)(?:[?#][^"'\s]*)?/i,
  },
  { label: 'secret-stream.invalid', pattern: /secret-stream\.invalid/ },
  {
    label: 'retired persistent provider secret vault',
    pattern: /moviestv-flix-secrets/,
  },
  { label: '__MOVIESTV_BUILD_ID__', pattern: /__MOVIESTV_BUILD_ID__/ },
  { label: '__MOVIESTV_SHELL_ASSETS__', pattern: /__MOVIESTV_SHELL_ASSETS__/ },
];

function fail(message) {
  console.error(`PWA verification failed: ${message}`);
  process.exit(1);
}

function walk(directory) {
  const files = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

function pngDimensions(path) {
  const data = readFileSync(path);
  if (data.length < 24) return null;

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!data.subarray(0, signature.length).equals(signature)) return null;
  if (data.readUInt32BE(8) !== 13) return null;
  if (data.toString('ascii', 12, 16) !== 'IHDR') return null;

  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function containsPrivilegedSupabaseJwt(content) {
  const jwtPattern =
    /(?:^|[^A-Za-z0-9_-])([A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,})(?=$|[^A-Za-z0-9_-])/g;

  for (const match of content.matchAll(jwtPattern)) {
    const token = match[1];
    const payloadSegment = token?.split('.')[1];
    if (!payloadSegment || payloadSegment.length > 16_384) continue;

    try {
      const payload = JSON.parse(
        Buffer.from(payloadSegment, 'base64url').toString('utf8'),
      );
      if (typeof payload?.role === 'string' && payload.role !== 'anon') return true;
    } catch {
      // Ignore non-JWT dotted strings and malformed payloads.
    }
  }

  return false;
}


if (!existsSync(root)) fail(`output directory does not exist: ${root}`);
if (existsSync(join(root, '404.html'))) {
  fail('top-level 404.html disables Cloudflare Pages SPA fallback');
}

for (const file of requiredFiles) {
  if (!existsSync(join(root, file))) fail(`missing required file: ${file}`);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
} catch {
  fail('manifest.webmanifest is not valid JSON');
}

if (manifest.id !== '/') fail('manifest id must stay stable at /');
if (manifest.start_url !== '/') fail('manifest start_url must be /');
if (manifest.scope !== '/') fail('manifest scope must be /');
if (manifest.display !== 'standalone') fail('manifest display must be standalone');
if (manifest.background_color !== '#09090b') {
  fail('manifest background_color must match the app shell');
}
if (manifest.theme_color !== '#09090b') {
  fail('manifest theme_color must match the app shell');
}
if (manifest.name !== 'MoviesTv-Flix') fail('manifest name must be MoviesTv-Flix');
if (manifest.short_name !== 'MoviesTv-Flix') {
  fail('manifest short_name must be MoviesTv-Flix');
}

const cloudflareHeaders = readFileSync(join(root, '_headers'), 'utf8');
const headerBlocks = new Map();
let currentHeaderPath = null;
for (const line of cloudflareHeaders.split(/\r?\n/)) {
  if (!line.trim()) continue;

  if (!/^\s/.test(line)) {
    currentHeaderPath = line.trim();
    if (!headerBlocks.has(currentHeaderPath)) {
      headerBlocks.set(currentHeaderPath, []);
    }
    continue;
  }

  if (currentHeaderPath) {
    headerBlocks.get(currentHeaderPath)?.push(line.trim());
  }
}

const globalHeaders = headerBlocks.get('/*') ?? [];
for (const requiredHeader of [
  /^x-content-type-options:\s*nosniff$/i,
  /^x-frame-options:\s*deny$/i,
  /^referrer-policy:\s*strict-origin-when-cross-origin$/i,
  /^permissions-policy:\s*camera=\(\),\s*microphone=\(\),\s*geolocation=\(\)$/i,
]) {
  if (!globalHeaders.some((header) => requiredHeader.test(header))) {
    fail(`missing baseline security header matching ${requiredHeader}`);
  }
}

for (const updatePath of [
  '/service-worker.js',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
]) {
  const headers = headerBlocks.get(updatePath) ?? [];
  const hasNoCache = headers.some((header) => (
    /^cache-control:\s*no-cache(?:\s*(?:,|$))/i.test(header)
  ));
  if (!hasNoCache) {
    fail(`${updatePath} must use Cache-Control: no-cache`);
  }
}

const updateManifestHeaders = headerBlocks.get('/updates/latest.json') ?? [];
if (!updateManifestHeaders.some((header) => (
  /^cache-control:\s*no-store(?:\s*(?:,|$))/i.test(header)
))) {
  fail('/updates/latest.json must use Cache-Control: no-store');
}

for (const releasePagePath of ['/updates/', '/updates/index.html']) {
  const headers = headerBlocks.get(releasePagePath) ?? [];
  if (!headers.some((header) => (
    /^cache-control:\s*no-cache(?:\s*(?:,|$))/i.test(header)
  ))) {
    fail(`${releasePagePath} must use Cache-Control: no-cache`);
  }
}
const releasePageHtml = readFileSync(join(root, 'updates/index.html'), 'utf8');
if (!/\bfetch\s*\(\s*(['"])\/api\/app-update\/manifest\1\s*[,)]/.test(releasePageHtml)) {
  fail('updates/index.html must load the native update manifest');
}

let nativeUpdateManifest;
try {
  nativeUpdateManifest = JSON.parse(
    readFileSync(join(root, 'updates/latest.json'), 'utf8'),
  );
} catch {
  fail('updates/latest.json is not valid JSON');
}
if (nativeUpdateManifest.schemaVersion !== 1) {
  fail('updates/latest.json schemaVersion must be 1');
}
if (typeof nativeUpdateManifest.channel !== 'string'
  || !nativeUpdateManifest.channel.trim()) {
  fail('updates/latest.json channel is required');
}

const trustedAndroidSigner =
  '0FD5A50BBEE30D1D3BBC7F1B5DDEE351A70C0F7BDA7F99EA17590F9311422D1D';
const expectedAndroidPackage = 'com.jugentorba.moviestvflix';
const expectedAppleBundle = 'com.jugentorba.moviestvflix';

function verifyNativeUpdateEntry(key, platform) {
  const entry = nativeUpdateManifest[key];
  if (entry === undefined) return;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    fail(`updates/latest.json ${key} must be an object`);
  }
  if (typeof entry.version !== 'string' || !entry.version.trim()) {
    fail(`updates/latest.json ${key}.version is required`);
  }
  if (!Number.isInteger(entry.build) || entry.build < 1) {
    fail(`updates/latest.json ${key}.build must be a positive integer`);
  }
  if (entry.releasePageUrl !== undefined) {
    let releasePageUrl;
    try {
      releasePageUrl = new URL(entry.releasePageUrl);
    } catch {
      fail(`updates/latest.json ${key}.releasePageUrl must be a valid URL`);
    }
    if (releasePageUrl.protocol !== 'https:') {
      fail(`updates/latest.json ${key}.releasePageUrl must use HTTPS`);
    }
  }

  if (platform === 'android') {
    if (entry.packageName !== expectedAndroidPackage) {
      fail(`updates/latest.json ${key} must use the MoviesTv-Flix Android package`);
    }
    if (entry.signingCertificateSha256 !== trustedAndroidSigner) {
      fail(
        `updates/latest.json ${key} must use the trusted Android signing certificate`,
      );
    }
  } else if (platform === 'apple') {
    if (entry.bundleIdentifier !== expectedAppleBundle) {
      fail(`updates/latest.json ${key} must use the MoviesTv-Flix Apple bundle`);
    }
    if (entry.resignable !== true) {
      fail(`updates/latest.json ${key} must remain re-signable`);
    }
  }

  if (entry.downloadUrl === undefined) return;

  let url;
  try {
    url = new URL(entry.downloadUrl);
  } catch {
    fail(`updates/latest.json ${key}.downloadUrl must be a valid URL`);
  }
  if (url.protocol !== 'https:') {
    fail(`updates/latest.json ${key}.downloadUrl must use HTTPS`);
  }
  if (typeof entry.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/i.test(entry.sha256)) {
    fail(`updates/latest.json ${key}.sha256 is required for a published package`);
  }
}

verifyNativeUpdateEntry('android', 'android');
verifyNativeUpdateEntry('androidTv', 'android');
verifyNativeUpdateEntry('ios', 'apple');
verifyNativeUpdateEntry('tvos', 'apple');

let pagesRoutes;
try {
  pagesRoutes = JSON.parse(readFileSync(join(root, '_routes.json'), 'utf8'));
} catch {
  fail('_routes.json is not valid JSON');
}
if (pagesRoutes.version !== 1) fail('_routes.json version must be 1');
if (!Array.isArray(pagesRoutes.include) || !pagesRoutes.include.includes('/api/*')) {
  fail('_routes.json must include /api/*');
}
if (!Array.isArray(pagesRoutes.exclude)) {
  fail('_routes.json exclude must be an array');
}
if (pagesRoutes.exclude.some((route) => (
  typeof route !== 'string'
  || route === '/*'
  || route === '/api'
  || route === '/api/*'
  || route.startsWith('/api/')
))) {
  fail('_routes.json must not exclude API functions');
}

const serviceWorker = readFileSync(join(root, 'service-worker.js'), 'utf8');
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
const workerBuildId = serviceWorker.match(
  /^\s*const\s+CACHE\s*=\s*(['"])moviestv-shell-([a-f0-9]{16})\1\s*;/im,
)?.[2]?.toLowerCase();
const pageBuildId = indexHtml.match(
  /<meta\s+[^>]*name=["']moviestv-build-id["'][^>]*content=["']([a-f0-9]{16})["'][^>]*>/i,
)?.[1]?.toLowerCase();

if (!workerBuildId) {
  fail('service worker is missing a stamped cache build id');
}
if (!pageBuildId) {
  fail('index.html is missing the stamped MoviesTv-Flix build id');
}
if (pageBuildId !== workerBuildId) {
  fail('index.html build id does not match the service-worker cache id');
}

const entryShellAssets = [...indexHtml.matchAll(
  /\b(?:src|href)=["'](\/[^"'?#]+\.(?:js|css))(?:[?#][^"']*)?["']/gi,
)]
  .map((match) => match[1])
  .filter((value, index, list) => list.indexOf(value) === index);

if (!entryShellAssets.length) {
  fail('index.html does not reference any local JS/CSS entry assets');
}
for (const assetPath of entryShellAssets) {
  if (!serviceWorker.includes(JSON.stringify(assetPath))) {
    fail(`service worker does not precache entry asset: ${assetPath}`);
  }
}

for (const requiredGuard of [
  "'/api/'",
  "'/auth/'",
  "'/rest/'",
  "'/realtime/'",
  "'/storage/'",
  "'/functions/'",
  'sensitiveQuery',
  'sensitiveHeaders',
  'responseUrlMayBeCached',
  'responseMayBeCached',
  'navigationResponseMayBeCached',
  'staticAssetResponseMayBeCached',
  "request.mode === 'navigate'",
  "caches.match('/')",
]) {
  if (!serviceWorker.includes(requiredGuard)) {
    fail(`service worker is missing dynamic-network guard: ${requiredGuard}`);
  }
}

const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
for (const size of ['192x192', '512x512']) {
  const icon = icons.find((entry) => entry && entry.sizes === size && typeof entry.src === 'string');
  if (!icon) fail(`manifest is missing a ${size} icon`);
  const iconPath = icon.src.replace(/^\/+/, '');
  const iconFile = resolve(root, iconPath);
  const relativeIconPath = relative(root, iconFile);
  if (
    !relativeIconPath
    || relativeIconPath === '..'
    || relativeIconPath.startsWith(`..${sep}`)
  ) {
    fail(`manifest icon escapes export root: ${icon.src}`);
  }
  if (!existsSync(iconFile)) fail(`manifest icon does not exist: ${icon.src}`);

  if (icon.type === 'image/png' || /\.png$/i.test(iconPath)) {
    const dimensions = pngDimensions(iconFile);
    if (!dimensions) {
      fail(`manifest PNG icon is invalid: ${icon.src}`);
    }
    const [expectedWidth, expectedHeight] = size
      .split('x')
      .map((value) => Number(value));
    if (
      dimensions.width !== expectedWidth
      || dimensions.height !== expectedHeight
    ) {
      fail(
        `manifest icon ${icon.src} is ${dimensions.width}x${dimensions.height}, expected ${size}`,
      );
    }
  }
}
const maskableIcon = icons.find((entry) => (
  entry
  && typeof entry.src === 'string'
  && typeof entry.purpose === 'string'
  && entry.purpose.split(/\s+/).includes('maskable')
));
if (!maskableIcon) fail('manifest must include at least one maskable icon');

const scannedFiles = walk(root);
const forbiddenArtifactPattern = /\.(?:key|p12|pfx|jks|keystore|mobileprovision)$/i;
for (const file of scannedFiles) {
  if (forbiddenArtifactPattern.test(file)) {
    fail(`forbidden signing/provisioning artifact found in ${relative(root, file)}`);
  }
}
const javascriptFiles = scannedFiles.filter((file) => /\.js$/i.test(file));
if (!javascriptFiles.length) fail('static export contains no JavaScript bundle');
const javascript = javascriptFiles
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');
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
  if (!javascript.includes(marker)) {
    fail(`exported JavaScript is missing PWA install marker: ${marker}`);
  }
}
for (const file of scannedFiles) {
  const content = readFileSync(file, 'utf8');
  for (const { label, pattern } of forbiddenPatterns) {
    if (pattern.test(content)) {
      fail(`forbidden marker ${label} found in ${relative(root, file)}`);
    }
  }
  if (containsPrivilegedSupabaseJwt(content)) {
    fail(
      `forbidden marker privileged Supabase JWT found in ${relative(root, file)}`,
    );
  }
}

console.log(
  `PWA export verified: ${requiredFiles.length} required files, ${icons.length} manifest icons, ${scannedFiles.length} files scanned`,
);

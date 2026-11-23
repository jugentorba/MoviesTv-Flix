import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ANDROID_PREVIEW_SIGNER_SHA256 =
  '0FD5A50BBEE30D1D3BBC7F1B5DDEE351A70C0F7BDA7F99EA17590F9311422D1D';
const ANDROID_PACKAGE_NAME = 'com.jugentorba.moviestvflix';
const APPLE_BUNDLE_IDENTIFIER = 'com.jugentorba.moviestvflix';

const PLATFORM_KEYS = {
  android: 'android',
  'android-tv': 'androidTv',
  ios: 'ios',
  tvos: 'tvos',
};

function fail(message) {
  console.error(`Update manifest error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith('--')) fail(`unexpected argument: ${token ?? ''}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail(`missing value for --${key}`);
    args.set(key, value);
    index += 1;
  }
  return args;
}

function required(args, name) {
  const value = args.get(name)?.trim();
  if (!value) fail(`--${name} is required`);
  return value;
}

function validateVersion(value) {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(value)) {
    fail('--version must be a semantic version such as 0.2.0');
  }
  return value;
}

function validateBuild(value) {
  const parsed = Number.parseInt(value, 10);
  if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < 1) {
    fail('--build must be a positive integer');
  }
  return parsed;
}

function validateUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') fail('--url must use HTTPS');
    return url.toString();
  } catch {
    fail('--url must be a valid HTTPS URL');
  }
}

function validateSha256(value) {
  const normalized = value.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  if (!/^[A-F0-9]{64}$/.test(normalized)) {
    fail('--sha256 must be a 64-character SHA-256 digest');
  }
  return normalized;
}

function cleanNotes(value) {
  const notes = value?.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!notes) return undefined;
  if (notes.length > 1000) fail('--notes must be 1000 characters or fewer');
  return notes;
}

const args = parseArgs(process.argv.slice(2));
const platform = required(args, 'platform');
const manifestKey = PLATFORM_KEYS[platform];
if (!manifestKey) {
  fail('--platform must be android, android-tv, ios, or tvos');
}

const version = validateVersion(required(args, 'version'));
const build = validateBuild(required(args, 'build'));
const url = args.has('url') ? validateUrl(required(args, 'url')) : undefined;
const releasePageUrl = args.has('release-page')
  ? validateUrl(required(args, 'release-page'))
  : undefined;
const sha256 = args.has('sha256')
  ? validateSha256(required(args, 'sha256'))
  : undefined;
if (url && !sha256) {
  fail('--sha256 is required when --url is provided');
}
if (sha256 && !url) {
  fail('--url is required when --sha256 is provided');
}

const outputPath = resolve(
  args.get('output')?.trim() || 'public/updates/latest.json',
);
if (!existsSync(outputPath)) {
  fail(`manifest does not exist: ${outputPath}`);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(outputPath, 'utf8'));
} catch {
  fail(`manifest is not valid JSON: ${outputPath}`);
}
if (manifest?.schemaVersion !== 1 || typeof manifest?.channel !== 'string') {
  fail('existing manifest must use schemaVersion 1 and include channel');
}

const current = manifest[manifestKey];
if (current && Number.isInteger(current.build) && build < current.build) {
  fail(
    `refusing to lower ${platform} build from ${current.build} to ${build}`,
  );
}

const entry = {
  version,
  build,
  ...(url ? { downloadUrl: url } : {}),
  ...(releasePageUrl ? { releasePageUrl } : {}),
  ...(sha256 ? { sha256 } : {}),
  ...(platform === 'android' || platform === 'android-tv'
    ? {
        packageName: ANDROID_PACKAGE_NAME,
        signingCertificateSha256: ANDROID_PREVIEW_SIGNER_SHA256,
      }
    : {
        bundleIdentifier: APPLE_BUNDLE_IDENTIFIER,
        resignable: true,
      }),
  ...(cleanNotes(args.get('notes'))
    ? { releaseNotes: cleanNotes(args.get('notes')) }
    : {}),
};

manifest[manifestKey] = entry;
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);

const fingerprint = createHash('sha256')
  .update(JSON.stringify(entry))
  .digest('hex')
  .slice(0, 12);
console.log(
  `Updated ${platform} release manifest to ${version} build ${build} (${fingerprint})`,
);

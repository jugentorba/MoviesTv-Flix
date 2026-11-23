import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(
  new URL('../write-update-manifest.mjs', import.meta.url),
);

const SIGNER =
  '0FD5A50BBEE30D1D3BBC7F1B5DDEE351A70C0F7BDA7F99EA17590F9311422D1D';
const SHA = 'A'.repeat(64);

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'moviestv-update-manifest-'));
  const manifest = join(root, 'latest.json');
  writeFileSync(
    manifest,
    JSON.stringify({
      schemaVersion: 1,
      channel: 'preview',
      android: { version: '0.1.0', build: 1 },
      androidTv: { version: '0.1.0', build: 1 },
      ios: { version: '0.1.0', build: 1, resignable: true },
      tvos: { version: '0.1.0', build: 1, resignable: true },
    }),
  );
  return { root, manifest };
}

function run(manifest, args) {
  return spawnSync(
    process.execPath,
    [script, ...args, '--output', manifest],
    { encoding: 'utf8' },
  );
}

{
  const { root, manifest } = fixture();
  try {
    const result = run(manifest, [
      '--platform', 'android',
      '--version', '0.2.0',
      '--build', '42',
      '--url', 'https://downloads.example/phone.apk',
      '--sha256', SHA,
      '--notes', 'Player and update improvements',
      '--release-page', 'https://downloads.example/releases/42',
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
    assert.equal(parsed.android.build, 42);
    assert.equal(parsed.android.downloadUrl, 'https://downloads.example/phone.apk');
    assert.equal(parsed.android.sha256, SHA);
    assert.equal(
      parsed.android.releasePageUrl,
      'https://downloads.example/releases/42',
    );
    assert.equal(parsed.android.packageName, 'com.jugentorba.moviestvflix');
    assert.equal(parsed.android.signingCertificateSha256, SIGNER);
    assert.equal(parsed.androidTv.build, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const { root, manifest } = fixture();
  try {
    const result = run(manifest, [
      '--platform', 'ios',
      '--version', '0.2.0',
      '--build', '43',
      '--url', 'https://downloads.example/phone.ipa',
      '--sha256', SHA,
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
    assert.equal(parsed.ios.build, 43);
    assert.equal(parsed.ios.bundleIdentifier, 'com.jugentorba.moviestvflix');
    assert.equal(parsed.ios.resignable, true);
    assert.equal(parsed.ios.sha256, SHA);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const { root, manifest } = fixture();
  try {
    const result = run(manifest, [
      '--platform', 'android',
      '--version', '0.2.0',
      '--build', '42',
      '--url', 'http://downloads.example/phone.apk',
      '--sha256', SHA,
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr || result.stdout, /HTTPS/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const { root, manifest } = fixture();
  try {
    const result = run(manifest, [
      '--platform', 'android-tv',
      '--version', '0.2.0',
      '--build', '42',
      '--url', 'https://downloads.example/tv.apk',
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr || result.stdout, /sha256 is required/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const { root, manifest } = fixture();
  try {
    const result = run(manifest, [
      '--platform', 'android',
      '--version', '0.0.9',
      '--build', '0',
    ]);
    assert.notEqual(result.status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

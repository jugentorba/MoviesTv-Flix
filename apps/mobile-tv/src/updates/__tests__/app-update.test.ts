import {
  ANDROID_PREVIEW_SIGNER_SHA256,
  androidUpdateSignerMatches,
  isNativeUpdateNewer,
  nativeUpdateIdentityMatches,
  parseUpdateManifest,
} from '../appUpdate';

test('parses a valid native update manifest', () => {
  const parsed = parseUpdateManifest({
    schemaVersion: 1,
    channel: 'preview',
    android: {
      version: '0.2.0',
      build: 12,
      downloadUrl: 'https://downloads.example/app.apk',
      packageName: 'com.jugentorba.moviestvflix',
      sha256: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      signingCertificateSha256: ANDROID_PREVIEW_SIGNER_SHA256,
    },
    ios: {
      version: '0.2.0',
      build: 13,
      downloadUrl: 'https://downloads.example/app.ipa',
      releasePageUrl: 'https://downloads.example/releases/13',
      bundleIdentifier: 'com.jugentorba.moviestvflix',
      resignable: true,
    },
  });

  expect(parsed?.android?.build).toBe(12);
  expect(parsed?.android?.sha256).toBe('A'.repeat(64));
  expect(parsed?.ios?.resignable).toBe(true);
  expect(parsed?.ios?.releasePageUrl).toBe(
    'https://downloads.example/releases/13',
  );
});

test('rejects insecure download URLs', () => {
  const parsed = parseUpdateManifest({
    schemaVersion: 1,
    channel: 'preview',
    android: {
      version: '0.2.0',
      build: 12,
      downloadUrl: 'http://downloads.example/app.apk',
      signingCertificateSha256: ANDROID_PREVIEW_SIGNER_SHA256,
    },
  });

  expect(parsed?.android?.downloadUrl).toBeUndefined();
});

test('compares monotonically increasing native build numbers', () => {
  const parsed = parseUpdateManifest({
    schemaVersion: 1,
    channel: 'preview',
    android: {
      version: '0.2.0',
      build: 12,
    },
  });

  expect(parsed?.android && isNativeUpdateNewer(parsed.android, 11)).toBe(true);
  expect(parsed?.android && isNativeUpdateNewer(parsed.android, 12)).toBe(false);
});

test('pins Android downloads to the preview signing certificate', () => {
  const trusted = parseUpdateManifest({
    schemaVersion: 1,
    channel: 'preview',
    android: {
      version: '0.2.0',
      build: 12,
      downloadUrl: 'https://downloads.example/app.apk',
      signingCertificateSha256: ANDROID_PREVIEW_SIGNER_SHA256,
    },
  })!.android!;

  const untrusted = parseUpdateManifest({
    schemaVersion: 1,
    channel: 'preview',
    android: {
      version: '0.2.0',
      build: 12,
      downloadUrl: 'https://downloads.example/app.apk',
      signingCertificateSha256:
        'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF',
    },
  })!.android!;

  expect(androidUpdateSignerMatches(trusted)).toBe(true);
  expect(androidUpdateSignerMatches(untrusted)).toBe(false);
});


test('keeps phone and TV update channels separate', () => {
  const parsed = parseUpdateManifest({
    schemaVersion: 1,
    channel: 'preview',
    android: {
      version: '0.2.0',
      build: 20,
    },
    androidTv: {
      version: '0.2.0',
      build: 21,
    },
    ios: {
      version: '0.2.0',
      build: 22,
      resignable: true,
    },
    tvos: {
      version: '0.2.0',
      build: 23,
      resignable: true,
    },
  });

  expect(parsed?.android?.build).toBe(20);
  expect(parsed?.androidTv?.build).toBe(21);
  expect(parsed?.ios?.build).toBe(22);
  expect(parsed?.tvos?.build).toBe(23);
});


test('pins native updates to the expected app identity', () => {
  const android = parseUpdateManifest({
    schemaVersion: 1,
    channel: 'preview',
    android: {
      version: '0.2.0',
      build: 12,
      packageName: 'com.jugentorba.moviestvflix',
    },
  })!.android!;

  const ios = parseUpdateManifest({
    schemaVersion: 1,
    channel: 'preview',
    ios: {
      version: '0.2.0',
      build: 12,
      bundleIdentifier: 'com.jugentorba.moviestvflix',
      resignable: true,
    },
  })!.ios!;

  expect(nativeUpdateIdentityMatches('android', android)).toBe(true);
  expect(nativeUpdateIdentityMatches('ios', ios)).toBe(true);
  expect(nativeUpdateIdentityMatches('android', {
    ...android,
    packageName: 'com.example.other',
  })).toBe(false);
  expect(nativeUpdateIdentityMatches('ios', {
    ...ios,
    bundleIdentifier: 'com.example.other',
  })).toBe(false);
});

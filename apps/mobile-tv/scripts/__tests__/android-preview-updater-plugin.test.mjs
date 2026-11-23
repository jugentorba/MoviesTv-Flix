import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  normalizeUpdaterManifest,
  patchMainApplication,
  updateModuleSource,
} = require('../../plugins/withAndroidPreviewUpdater.js');

const manifest = {
  manifest: {
    'uses-permission': [],
    application: [
      {
        $: {},
        provider: [],
      },
    ],
  },
};

normalizeUpdaterManifest(manifest);
normalizeUpdaterManifest(manifest);

const installPermissions = manifest.manifest['uses-permission']
  .filter((entry) => (
    entry?.$?.['android:name']
      === 'android.permission.REQUEST_INSTALL_PACKAGES'
  ));
assert.equal(installPermissions.length, 1);

const providers = manifest.manifest.application[0].provider;
assert.equal(providers.length, 1);
assert.equal(
  providers[0].$['android:name'],
  'androidx.core.content.FileProvider',
);
assert.equal(
  providers[0].$['android:authorities'],
  '${applicationId}.updates',
);
assert.equal(providers[0].$['android:exported'], 'false');
assert.equal(providers[0].$['android:grantUriPermissions'], 'true');
assert.equal(
  providers[0]['meta-data'][0].$['android:resource'],
  '@xml/moviestv_update_paths',
);

const mainApplication = `package com.jugentorba.moviestvflix

class MainApplication {
  override fun getPackages() =
    PackageList(this).packages.apply {
    }
}
`;
const patched = patchMainApplication(mainApplication);
assert.match(
  patched,
  /add\(MoviesTvFlixPreviewUpdaterPackage\(\)\)/,
);
assert.equal(
  patchMainApplication(patched),
  patched,
  'MainApplication patch must be idempotent',
);

const moduleSource = updateModuleSource(
  'com.jugentorba.moviestvflix',
);
assert.match(
  moduleSource,
  /EXPECTED_PACKAGE = "com\.jugentorba\.moviestvflix"/,
);
assert.match(
  moduleSource,
  /0FD5A50BBEE30D1D3BBC7F1B5DDEE351A70C0F7BDA7F99EA17590F9311422D1D/,
);
assert.match(moduleSource, /sha256\(file\) != expectedHash/);
assert.match(moduleSource, /archiveVersion <= currentVersionCode\(\)/);
assert.match(moduleSource, /canRequestPackageInstalls\(\)/);
assert.match(moduleSource, /ACTION_MANAGE_UNKNOWN_APP_SOURCES/);
assert.match(moduleSource, /FileProvider\.getUriForFile/);

console.log('PASS Android preview updater plugin contract');

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import appConfig from '../../app.config';


function pngDimensions(path: string): { width: number; height: number } {
  const png = readFileSync(path);
  expect(png.subarray(0, 8).toString('hex'))
    .toBe('89504e470d0a1a0a');
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

test('excludes the React Native TV alias from Expo version validation', () => {
  const packageJson = JSON.parse(
    readFileSync(resolve(__dirname, '../../package.json'), 'utf8'),
  ) as {
    expo?: { install?: { exclude?: string[] } };
  };

  expect(packageJson.expo?.install?.exclude).toContain('react-native');
});

test('keeps Expo SDK 56 aligned with the React Native TV fork', () => {
  const packageJson = JSON.parse(
    readFileSync(resolve(__dirname, '../../package.json'), 'utf8'),
  ) as {
    dependencies?: Record<string, string>;
  };

  expect(packageJson.dependencies?.expo).toBe('^56.0.0');
  expect(packageJson.dependencies?.react).toBe('19.2.3');
  expect(packageJson.dependencies?.['react-native'])
    .toBe('npm:react-native-tvos@0.85-stable');
});

test('uses stable MoviesTv-Flix mobile identifiers', () => {
  expect(appConfig.expo.android?.package).toBe('com.jugentorba.moviestvflix');
  expect(appConfig.expo.ios?.bundleIdentifier).toBe('com.jugentorba.moviestvflix');
});

test('exports web as a Metro single-page app', () => {
  expect(appConfig.expo.web).toEqual(expect.objectContaining({
    bundler: 'metro',
    output: 'single',
  }));
});


test('TV Expo config pins tvOS to the Expo SDK 56 minimum', () => {
  const source = readFileSync(
    resolve(__dirname, '../../app.config.ts'),
    'utf8',
  );

  expect(source).toContain("process.env.EXPO_TV === '1'");
  expect(source).toContain("'@react-native-tvos/config-tv'");
  expect(source).toContain("isTV: true");
  expect(source).toContain("tvosDeploymentTarget: '16.4'");
  expect(source).toContain("androidTVRequired: true");
  expect(source).toContain("androidTVIcon: './assets/icon.png'");
  expect(source).toContain("androidTVBanner: './assets/tv-banner.png'");
  expect(source).toContain("icon: './assets/icon.png'");
  expect(source).toContain("'expo-file-system'");
});


test('TV Expo config installs the Android channel-key consumer', () => {
  const source = readFileSync(
    resolve(__dirname, '../../app.config.ts'),
    'utf8',
  );
  const plugin = require(
    '../../plugins/withAndroidTvChannelKeys',
  ) as {
    patchMainActivity(contents: string): string;
    normalizeAndroidTvManifestFeatures(manifest: {
      manifest: Record<string, unknown>;
    }): {
      manifest: Record<string, unknown>;
    };
  };

  expect(source).toContain("'./plugins/withAndroidTvChannelKeys'");

  const activity = `package com.jugentorba.moviestvflix

import com.facebook.react.ReactActivity

class MainActivity : ReactActivity() {
  override fun getMainComponentName(): String = "main"
}
`;

  const patched = plugin.patchMainActivity(activity);
  expect(patched).toContain('import android.view.KeyEvent');
  expect(patched).toContain('KeyEvent.KEYCODE_CHANNEL_UP');
  expect(patched).toContain('KeyEvent.KEYCODE_CHANNEL_DOWN');
  expect(patched).toContain('super.onKeyDown(keyCode, event)');
  expect(patched).toContain('super.onKeyUp(keyCode, event)');
  expect(plugin.patchMainActivity(patched)).toBe(patched);
});

test('normalizes Android TV hardware feature requirements', () => {
  const plugin = require(
    '../../plugins/withAndroidTvChannelKeys',
  ) as {
    normalizeAndroidTvManifestFeatures(manifest: {
      manifest: Record<string, any>;
    }): {
      manifest: Record<string, any>;
    };
  };

  const manifest = {
    manifest: {
      'uses-feature': [
        {
          $: {
            'android:name': 'android.hardware.touchscreen',
            'android:required': 'true',
          },
        },
        {
          $: {
            'android:name': 'android.software.leanback',
            'android:required': 'false',
          },
        },
        {
          $: {
            'android:name': 'android.software.leanback',
            'android:required': 'false',
          },
        },
      ],
    },
  };

  const normalized = plugin.normalizeAndroidTvManifestFeatures(manifest);
  const features = normalized.manifest['uses-feature'] as Array<{
    $: Record<string, string>;
  }>;

  const byName = new Map(
    features.map((feature) => [feature.$['android:name'], feature.$]),
  );
  expect(
    features.filter(
      (feature) => feature.$['android:name'] === 'android.software.leanback',
    ),
  ).toHaveLength(1);
  expect(byName.get('android.hardware.touchscreen')?.['android:required'])
    .toBe('false');
  expect(byName.get('android.hardware.faketouch')?.['android:required'])
    .toBe('false');
  expect(byName.get('android.software.leanback')?.['android:required'])
    .toBe('true');
});

test('ships native preview artwork with expected dimensions', () => {
  // The launcher icon is the 1024 master the stores expect; the 512 placeholder
  // it replaced was upscaled by the OS and looked soft on every home screen.
  expect(pngDimensions(
    resolve(__dirname, '../../assets/icon.png'),
  )).toEqual({ width: 1024, height: 1024 });
  // Android's adaptive foreground is a separate asset so the mask only crops
  // background. Same 1024 canvas, the mark inside the safe zone.
  expect(pngDimensions(
    resolve(__dirname, '../../assets/adaptive-icon.png'),
  )).toEqual({ width: 1024, height: 1024 });
  expect(pngDimensions(
    resolve(__dirname, '../../assets/tv-banner.png'),
  )).toEqual({ width: 320, height: 180 });
});


test('configures native HTTP media without weakening provider manifest validation', () => {
  const source = readFileSync(
    resolve(__dirname, '../../app.config.ts'),
    'utf8',
  );
  const plugin = readFileSync(
    resolve(__dirname, '../../plugins/withNativeHttpMedia.js'),
    'utf8',
  );

  expect(source).toContain("'./plugins/withNativeHttpMedia'");
  expect(plugin).toContain("'android:usesCleartextTraffic'");
  expect(plugin).toContain('NSAllowsArbitraryLoadsForMedia');
  expect(plugin).toContain("require('expo/config-plugins')");
});

const { withAndroidManifest, withMainActivity } = require('expo/config-plugins');

const PATCH_MARKER = 'MoviesTv-Flix TV channel key handling';

const TV_FEATURE_REQUIREMENTS = [
  ['android.hardware.touchscreen', 'false'],
  ['android.hardware.faketouch', 'false'],
  ['android.software.leanback', 'true'],
];

function normalizeAndroidTvManifestFeatures(androidManifest) {
  const manifest = androidManifest?.manifest;
  if (!manifest) {
    throw new Error('Unable to locate Android manifest for TV features');
  }
  const features = Array.isArray(manifest['uses-feature'])
    ? manifest['uses-feature']
    : [];
  manifest['uses-feature'] = features;

  for (const [name, required] of TV_FEATURE_REQUIREMENTS) {
    const matchingIndexes = [];
    for (let index = 0; index < features.length; index += 1) {
      if (features[index]?.$?.['android:name'] === name) {
        matchingIndexes.push(index);
      }
    }

    let feature;
    if (matchingIndexes.length) {
      feature = features[matchingIndexes[0]];
      for (let index = matchingIndexes.length - 1; index > 0; index -= 1) {
        features.splice(matchingIndexes[index], 1);
      }
    } else {
      feature = { $: { 'android:name': name } };
      features.push(feature);
    }

    feature.$ = {
      ...(feature.$ ?? {}),
      'android:name': name,
      'android:required': required,
    };
  }

  return androidManifest;
}


function patchMainActivity(contents) {
  if (contents.includes(PATCH_MARKER)) return contents;
  if (!/class\s+MainActivity\s*:\s*ReactActivity\(\)\s*\{/.test(contents)) {
    throw new Error('Unable to locate MainActivity class for TV channel keys');
  }

  let next = contents;
  if (!next.includes('import android.view.KeyEvent')) {
    const packageMatch = /^package\s+[^\n]+\n/m.exec(next);
    if (!packageMatch) {
      throw new Error('Unable to locate MainActivity package declaration');
    }
    const insertAt = packageMatch.index + packageMatch[0].length;
    next =
      next.slice(0, insertAt)
      + '\nimport android.view.KeyEvent\n'
      + next.slice(insertAt);
  }

  const classEnd = next.lastIndexOf('\n}');
  if (classEnd < 0) {
    throw new Error('Unable to locate MainActivity class end');
  }

  const methods = `

  // ${PATCH_MARKER}
  override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
    val handledByReactNative = super.onKeyDown(keyCode, event)
    return when (keyCode) {
      KeyEvent.KEYCODE_CHANNEL_UP,
      KeyEvent.KEYCODE_CHANNEL_DOWN -> true
      else -> handledByReactNative
    }
  }

  override fun onKeyUp(keyCode: Int, event: KeyEvent?): Boolean {
    val handledByReactNative = super.onKeyUp(keyCode, event)
    return when (keyCode) {
      KeyEvent.KEYCODE_CHANNEL_UP,
      KeyEvent.KEYCODE_CHANNEL_DOWN -> true
      else -> handledByReactNative
    }
  }
`;

  return next.slice(0, classEnd) + methods + next.slice(classEnd);
}

function withAndroidTvChannelKeys(config) {
  const withTvFeatures = withAndroidManifest(config, (nextConfig) => {
    nextConfig.modResults = normalizeAndroidTvManifestFeatures(
      nextConfig.modResults,
    );
    return nextConfig;
  });

  return withMainActivity(withTvFeatures, (nextConfig) => {
    if (nextConfig.modResults.language !== 'kt') {
      throw new Error('Android TV channel key handling requires Kotlin MainActivity');
    }
    nextConfig.modResults.contents = patchMainActivity(
      nextConfig.modResults.contents,
    );
    return nextConfig;
  });
}

module.exports = withAndroidTvChannelKeys;
module.exports.patchMainActivity = patchMainActivity;

module.exports.normalizeAndroidTvManifestFeatures = normalizeAndroidTvManifestFeatures;

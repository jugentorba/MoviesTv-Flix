const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = 'libc++_shared.so';

/*
 * `org.videolan.android:libvlc-all` and `com.facebook.react:react-android` both
 * bundle `libc++_shared.so` for every ABI, so the Android native-library merge
 * fails with a duplicate-file error unless one copy is picked. The native
 * surface needs libvlc, therefore the app needs this packaging rule.
 */
const PACKAGING_BLOCK = `
// libvlc-all and react-android both ship libc++_shared.so; pick one copy.
android {
    packaging {
        jniLibs {
            pickFirsts.add('**/libc++_shared.so')
        }
    }
}
`;

function addLibcxxSharedPickFirst(contents) {
  if (typeof contents !== 'string' || !contents.includes('android {')) {
    throw new Error(
      'android/app/build.gradle is unavailable for the libvlc packaging rule',
    );
  }
  if (contents.includes(MARKER)) return contents;
  return `${contents.replace(/\s*$/, '')}\n${PACKAGING_BLOCK}`;
}

function withAndroidVlcJniLibs(config) {
  return withAppBuildGradle(config, (nextConfig) => {
    nextConfig.modResults.contents = addLibcxxSharedPickFirst(
      nextConfig.modResults.contents,
    );
    return nextConfig;
  });
}

module.exports = withAndroidVlcJniLibs;
module.exports.addLibcxxSharedPickFirst = addLibcxxSharedPickFirst;

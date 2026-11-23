const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

/*
 * React Native 0.85's Gradle plugin (the included build at
 * `@react-native/gradle-plugin`) applies `foojay-resolver-convention:0.5.0`,
 * which reads `JvmVendorSpec.IBM_SEMERU`. Gradle 9 removed that constant, so a
 * wrapper on 9.x fails configuration with
 * `NoSuchFieldError ... JvmVendorSpec IBM_SEMERU` before any app code compiles.
 * Gradle 8.14.3 has the constant and builds the app (verified 2026-11-17).
 *
 * Pin the wrapper here instead of editing `android/`, which is generated.
 */
const GRADLE_VERSION = '8.14.3';

const DISTRIBUTION_URL = `distributionUrl=https\\://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip`;

function pinGradleDistribution(contents) {
  if (typeof contents !== 'string' || !/^distributionUrl=/m.test(contents)) {
    throw new Error(
      'android/gradle/wrapper/gradle-wrapper.properties is unavailable for the Gradle pin',
    );
  }
  return contents.replace(/^distributionUrl=.*$/m, DISTRIBUTION_URL);
}

function withAndroidGradleWrapper(config) {
  return withDangerousMod(config, [
    'android',
    async (nextConfig) => {
      const wrapper = path.join(
        nextConfig.modRequest.platformProjectRoot,
        'gradle',
        'wrapper',
        'gradle-wrapper.properties',
      );
      const contents = await fs.promises.readFile(wrapper, 'utf8');
      await fs.promises.writeFile(
        wrapper,
        pinGradleDistribution(contents),
        'utf8',
      );
      return nextConfig;
    },
  ]);
}

module.exports = withAndroidGradleWrapper;
module.exports.GRADLE_VERSION = GRADLE_VERSION;
module.exports.pinGradleDistribution = pinGradleDistribution;

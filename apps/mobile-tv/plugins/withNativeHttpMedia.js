const {
  withAndroidManifest,
  withInfoPlist,
} = require('expo/config-plugins');

function withAndroidHttpMedia(config) {
  return withAndroidManifest(config, (nextConfig) => {
    const application =
      nextConfig.modResults?.manifest?.application?.[0];
    if (!application) {
      throw new Error(
        'Android application manifest is unavailable for HTTP media policy',
      );
    }

    application.$ = application.$ ?? {};
    application.$['android:usesCleartextTraffic'] = 'true';
    return nextConfig;
  });
}

function withAppleHttpMedia(config) {
  return withInfoPlist(config, (nextConfig) => {
    const current = nextConfig.modResults.NSAppTransportSecurity;
    const ats = (
      current
      && typeof current === 'object'
      && !Array.isArray(current)
    )
      ? current
      : {};

    nextConfig.modResults.NSAppTransportSecurity = {
      ...ats,
      NSAllowsArbitraryLoadsForMedia: true,
    };
    return nextConfig;
  });
}

function withNativeHttpMedia(config) {
  return withAppleHttpMedia(withAndroidHttpMedia(config));
}

module.exports = withNativeHttpMedia;
module.exports.withAndroidHttpMedia = withAndroidHttpMedia;
module.exports.withAppleHttpMedia = withAppleHttpMedia;

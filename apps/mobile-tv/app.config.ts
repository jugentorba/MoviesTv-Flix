const appVersion = process.env.EXPO_PUBLIC_APP_VERSION?.trim() || '0.7.5';
const parsedBuildNumber = Number.parseInt(
  process.env.EXPO_PUBLIC_BUILD_NUMBER
    ?? process.env.ANDROID_VERSION_CODE
    ?? process.env.GITHUB_RUN_NUMBER
    ?? process.env.BUILD_NUMBER
    ?? '1',
  10,
);
const buildNumber =
  Number.isFinite(parsedBuildNumber) && parsedBuildNumber > 0
    ? parsedBuildNumber
    : 1;

const parsedAndroidVersionCode = Number.parseInt(
  process.env.ANDROID_VERSION_CODE ?? String(buildNumber),
  10,
);
const androidVersionCode =
  Number.isFinite(parsedAndroidVersionCode) && parsedAndroidVersionCode > 0
    ? parsedAndroidVersionCode
    : 1;

const updateManifestUrl =
  process.env.EXPO_PUBLIC_UPDATE_MANIFEST_URL?.trim()
  || 'https://main.moviestv-flix.pages.dev/api/app-update/manifest';

const plugins = [
  ...(process.env.EXPO_PUBLIC_PREVIEW_MODE === '1'
    ? ['./plugins/withAndroidPreviewUpdater']
    : []),
  ...(process.env.EXPO_TV === '1'
    ? [
        [
          '@react-native-tvos/config-tv',
          {
            isTV: true,
            tvosDeploymentTarget: '16.4',
            androidTVRequired: true,
            androidTVIcon: './assets/icon.png',
            androidTVBanner: './assets/tv-banner.png',
          },
        ],
        './plugins/withAndroidTvChannelKeys',
      ]
    : []),
  // Picture-in-picture is a native capability the player now exposes.
  ['expo-video', { supportsPictureInPicture: true }],
  './plugins/withNativeHttpMedia',
  './plugins/withAndroidVlcJniLibs',
  './plugins/withAndroidGradleWrapper',
  // iOS/tvOS 27 refuse to launch without the scene-based lifecycle.
  './plugins/withIosSceneLifecycle',
  // Xcode 27 rejects pod targets still declaring iOS 13/14.
  './plugins/withIosPodsDeploymentTarget',
  [
    'expo-file-system',
    {
      supportsOpeningDocumentsInPlace: true,
      enableFileSharing: true,
    },
  ],
];

export default {
  expo: {
    name: 'MoviesTv-Flix',
    slug: 'moviestv-flix',
    scheme: 'moviestvflix',
    icon: './assets/icon.png',
    version: appVersion,
    android: {
      package: 'com.jugentorba.moviestvflix',
      versionCode: androidVersionCode,
      // Android masks the launcher icon into a circle/squircle, so the mark
      // ships as a transparent foreground over the brand background instead of
      // a pre-rounded bitmap that the mask would crop.
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#0B0B10',
      },
    },
    ios: {
      bundleIdentifier: 'com.jugentorba.moviestvflix',
      buildNumber: String(buildNumber),
      supportsTablet: true,
    },
    web: {
      bundler: 'metro',
      output: 'single',
    },
    extra: {
      appVersion,
      buildNumber,
      updateManifestUrl,
    },
    plugins,
  },
};

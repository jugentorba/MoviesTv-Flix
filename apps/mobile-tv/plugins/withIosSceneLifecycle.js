const fs = require('fs');
const path = require('path');
const { withDangerousMod, withInfoPlist } = require('expo/config-plugins');

/*
 * iOS 27 and tvOS 27 require the scene-based lifecycle. React Native's
 * `UIWindow(frame: UIScreen.main.bounds)` startup is not scene-aware, so an app
 * built with the iOS 27 SDK installs and then dies on launch with
 * `UIScene life cycle is required for apps built with this SDK`.
 *
 * The generated AppDelegate and Info.plist are overwritten by every prebuild, so
 * the fix lives here instead of in `ios/` (which is gitignored). Without this
 * plugin the iOS build simply does not boot.
 *
 * The change is deliberately conditional: `startReactNative` still runs the old
 * way when no scene manifest exists, so the same AppDelegate keeps working on
 * iOS versions that predate scene adoption.
 */

const SCENE_DELEGATE_CLASS = 'SceneDelegate';
const MARKER = 'MTFLIX_SCENE_LIFECYCLE';

const LEGACY_START = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif`;

const SCENE_AWARE_START = `#if os(iOS) || os(tvOS)
    // ${MARKER}: with a scene manifest the scene delegate owns the window and
    // starts React Native; starting it here as well would create a second,
    // detached window. Without the manifest (older iOS) keep the legacy path.
    if Bundle.main.object(forInfoDictionaryKey: "UIApplicationSceneManifest") == nil {
      window = UIWindow(frame: UIScreen.main.bounds)
      factory.startReactNative(
        withModuleName: "main",
        in: window,
        launchOptions: launchOptions)
    }
#endif`;

const SCENE_DELEGATE_SOURCE = `
@objc(${SCENE_DELEGATE_CLASS})
class ${SCENE_DELEGATE_CLASS}: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate = UIApplication.shared.delegate as? AppDelegate,
          let factory = appDelegate.reactNativeFactory else { return }
    let window = UIWindow(windowScene: windowScene)
    appDelegate.window = window
    self.window = window
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: nil)
    window.makeKeyAndVisible()
  }
}
`;

/**
 * Makes the AppDelegate scene-aware and appends the scene delegate.
 *
 * Throws when the expected block is missing: a silent no-op would produce a
 * build that installs and refuses to launch, which is harder to diagnose than a
 * prebuild failure.
 */
function applySceneLifecycle(source) {
  if (typeof source !== 'string' || !source.includes('class AppDelegate')) {
    throw new Error('AppDelegate.swift was not found where prebuild puts it');
  }
  if (source.includes(MARKER)) return source;
  if (!source.includes(LEGACY_START)) {
    throw new Error(
      'AppDelegate.swift no longer contains the React Native startup block this '
      + 'plugin rewrites; update plugins/withIosSceneLifecycle.js for the new template',
    );
  }
  const patched = source.replace(LEGACY_START, SCENE_AWARE_START);
  if (patched.includes(SCENE_DELEGATE_CLASS)) return patched;
  return `${patched.trimEnd()}\n${SCENE_DELEGATE_SOURCE}`;
}

function sceneManifest() {
  return {
    UIApplicationSupportsMultipleScenes: false,
    UISceneConfigurations: {
      UIWindowSceneSessionRoleApplication: [
        {
          UISceneConfigurationName: 'Default Configuration',
          UISceneDelegateClassName: SCENE_DELEGATE_CLASS,
        },
      ],
    },
  };
}

function withIosSceneLifecycle(config) {
  const withPlist = withInfoPlist(config, (nextConfig) => {
    nextConfig.modResults.UIApplicationSceneManifest = sceneManifest();
    return nextConfig;
  });

  return withDangerousMod(withPlist, [
    'ios',
    async (nextConfig) => {
      const appDelegate = path.join(
        nextConfig.modRequest.platformProjectRoot,
        nextConfig.modRequest.projectName ?? 'MoviesTvFlix',
        'AppDelegate.swift',
      );
      const contents = await fs.promises.readFile(appDelegate, 'utf8');
      await fs.promises.writeFile(
        appDelegate,
        applySceneLifecycle(contents),
        'utf8',
      );
      return nextConfig;
    },
  ]);
}

module.exports = withIosSceneLifecycle;
module.exports.applySceneLifecycle = applySceneLifecycle;
module.exports.sceneManifest = sceneManifest;
module.exports.SCENE_DELEGATE_CLASS = SCENE_DELEGATE_CLASS;
module.exports.MARKER = MARKER;
module.exports.LEGACY_START = LEGACY_START;

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  LEGACY_START,
  MARKER,
  SCENE_DELEGATE_CLASS,
  applySceneLifecycle,
  sceneManifest,
} = require('../../plugins/withIosSceneLifecycle.js');

// The exact startup block Expo 56 generates. The plugin rewrites this string, so
// the fixture must stay in step with the template rather than with our output.
const pristine = `import Expo

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let factory = ExpoReactNativeFactory(delegate: delegate)

${LEGACY_START}

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
`;

const patched = applySceneLifecycle(pristine);

assert.match(
  patched,
  new RegExp(MARKER),
  'the patched AppDelegate must be marked so a second prebuild does not patch twice',
);
assert.match(
  patched,
  /if Bundle\.main\.object\(forInfoDictionaryKey: "UIApplicationSceneManifest"\) == nil \{/,
  'React Native must only start from the AppDelegate when no scene manifest exists',
);
assert.match(
  patched,
  /#if os\(iOS\) \|\| os\(tvOS\)/,
  'the platform guard around the startup block must be preserved',
);
assert.match(
  patched,
  new RegExp(`@objc\\(${SCENE_DELEGATE_CLASS}\\)\\nclass ${SCENE_DELEGATE_CLASS}: UIResponder, UIWindowSceneDelegate`),
  'the scene delegate must be exposed under its bare Objective-C name for Info.plist',
);
assert.match(
  patched,
  /let window = UIWindow\(windowScene: windowScene\)/,
  'the scene delegate must build a window for the incoming scene',
);
assert.match(
  patched,
  /factory\.startReactNative\(withModuleName: "main", in: window, launchOptions: nil\)/,
  'the scene delegate must start React Native into the scene window',
);
assert.ok(
  !patched.includes(LEGACY_START),
  'the unguarded startup block must be gone, otherwise iOS 27 double-starts the app',
);
assert.equal(
  applySceneLifecycle(patched),
  patched,
  'prebuild must be idempotent: a second run must not append a second delegate',
);
assert.equal(
  patched.match(new RegExp(`class ${SCENE_DELEGATE_CLASS}:`, 'g')).length,
  1,
  'exactly one scene delegate class',
);
assert.throws(
  () => applySceneLifecycle('class AppDelegate: ExpoAppDelegate {}'),
  /no longer contains the React Native startup block/,
  'a template change must fail loudly instead of producing an app that cannot launch',
);
assert.throws(
  () => applySceneLifecycle('// not an app delegate'),
  /AppDelegate\.swift was not found/,
);

const manifest = sceneManifest();
assert.equal(
  manifest.UIApplicationSupportsMultipleScenes,
  false,
  'the app is single-window',
);
const configurations = manifest.UISceneConfigurations.UIWindowSceneSessionRoleApplication;
assert.equal(configurations.length, 1, 'one application scene configuration');
assert.equal(configurations[0].UISceneDelegateClassName, SCENE_DELEGATE_CLASS);

console.log('PASS iOS scene lifecycle plugin contract');

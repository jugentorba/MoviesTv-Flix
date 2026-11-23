import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  DEPLOYMENT_TARGET,
  TV_DEPLOYMENT_TARGET,
  MARKER,
  raiseDeploymentTargets,
} = require('../../plugins/withIosPodsDeploymentTarget.js');

// The shape Expo 56 generates, reduced to the parts the plugin depends on.
const podfile = `platform :ios, podfile_properties['ios.deploymentTarget'] || '16.4'

target 'MoviesTvFlix' do
  use_expo_modules!

  post_install do |installer|
    react_native_post_install(
      installer,
      config[:reactNativePath],
      :mac_catalyst_enabled => false,
      :ccache_enabled => ccache_enabled?(podfile_properties),
    )
  end
end
`;

const patched = raiseDeploymentTargets(podfile);

assert.match(patched, new RegExp(MARKER), 'the patch must be marked for idempotency');
assert.match(
  patched,
  new RegExp(`IPHONEOS_DEPLOYMENT_TARGET'\\] = '${DEPLOYMENT_TARGET.replace('.', '\\.')}'`),
  'pod targets must be raised to the app minimum',
);
assert.match(
  patched,
  /installer\.pods_project\.targets\.each do \|target\|/,
  'every pod target must be visited, including resource bundles',
);
assert.match(
  patched,
  new RegExp(`TVOS_DEPLOYMENT_TARGET'\\] = '${TV_DEPLOYMENT_TARGET.replace('.', '\\.')}'`),
  'tvOS pod targets must be raised too, or the TV build fails on the same pods',
);
assert.ok(
  patched.indexOf(MARKER) > patched.indexOf('react_native_post_install'),
  'the fix must run after react_native_post_install so it cannot be overwritten',
);
assert.equal(
  raiseDeploymentTargets(patched),
  patched,
  'prebuild must be idempotent',
);
assert.equal(
  patched.match(new RegExp(MARKER, 'g')).length,
  1,
  'exactly one patch block',
);
assert.match(
  podfile.includes(MARKER) ? patched : patched,
  /target 'MoviesTvFlix' do/,
  'the rest of the Podfile must be preserved',
);
assert.throws(
  () => raiseDeploymentTargets('platform :ios, "16.4"\ntarget "X" do\nend\n'),
  /no post_install hook/,
);
assert.throws(
  () => raiseDeploymentTargets("target 'X' do\n  post_install do |installer|\n    other()\n  end\nend\n"),
  /react_native_post_install/,
);
assert.throws(() => raiseDeploymentTargets(''), /Podfile was not found/);

console.log('PASS iOS pod deployment target plugin contract');

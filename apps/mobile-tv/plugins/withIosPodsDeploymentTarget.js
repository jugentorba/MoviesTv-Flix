const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

/*
 * Xcode 27 dropped support for deployment targets below iOS 15:
 *
 *   error: The iOS Simulator deployment target 'IPHONEOS_DEPLOYMENT_TARGET' is
 *   set to 13.4, but the range of supported deployment target versions is
 *   15.0 to 27.2.x.
 *   (in target 'RNCAsyncStorage-RNCAsyncStorage_resources' from project 'Pods')
 *
 * CocoaPods keeps each pod's own minimum, so a single stale podspec blocks the
 * whole workspace even though the app target itself is on 16.4. Raising every
 * pod target to the app's minimum is the standard fix.
 *
 * `ios/` is generated and gitignored, so this belongs in a plugin.
 */

const DEPLOYMENT_TARGET = '16.4';
// tvOS has its own build setting, and a TV build fails on the same stale pods.
const TV_DEPLOYMENT_TARGET = '16.4';
const MARKER = 'MTFLIX_IOS_DEPLOYMENT_TARGET';

const POST_INSTALL_ANCHOR = '  post_install do |installer|';
// The whole `react_native_post_install(...)` call has to stay intact: inserting
// before its closing paren would put Ruby statements inside the argument list.
const POST_INSTALL_END_ANCHOR = `      :ccache_enabled => ccache_enabled?(podfile_properties),
    )`;

const RAISE_TARGETS = `    # ${MARKER}: align every pod target with the app minimum so Xcode 27 can
    # build pods whose podspec still declares iOS 13/14 or tvOS 11.
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        current = config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'].to_s
        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${DEPLOYMENT_TARGET}' if current.empty? || current < '${DEPLOYMENT_TARGET}'
        current_tv = config.build_settings['TVOS_DEPLOYMENT_TARGET'].to_s
        config.build_settings['TVOS_DEPLOYMENT_TARGET'] = '${TV_DEPLOYMENT_TARGET}' if current_tv.empty? || current_tv < '${TV_DEPLOYMENT_TARGET}'
      end
    end`;

/**
 * Inserts the target-raising loop at the end of the Podfile's `post_install`
 * hook, after React Native's own post-install work.
 */
function raiseDeploymentTargets(podfile) {
  if (typeof podfile !== 'string' || !podfile.includes('target ')) {
    throw new Error('Podfile was not found where prebuild puts it');
  }
  if (podfile.includes(MARKER)) return podfile;
  if (!podfile.includes(POST_INSTALL_ANCHOR)) {
    throw new Error(
      'Podfile has no post_install hook; update plugins/withIosPodsDeploymentTarget.js',
    );
  }
  if (!podfile.includes(POST_INSTALL_END_ANCHOR)) {
    throw new Error(
      'Podfile post_install no longer calls react_native_post_install the expected '
      + 'way; update plugins/withIosPodsDeploymentTarget.js',
    );
  }
  return podfile.replace(
    POST_INSTALL_END_ANCHOR,
    `${POST_INSTALL_END_ANCHOR}\n${RAISE_TARGETS}`,
  );
}

function withIosPodsDeploymentTarget(config) {
  return withDangerousMod(config, [
    'ios',
    async (nextConfig) => {
      const podfilePath = path.join(nextConfig.modRequest.platformProjectRoot, 'Podfile');
      const contents = await fs.promises.readFile(podfilePath, 'utf8');
      await fs.promises.writeFile(
        podfilePath,
        raiseDeploymentTargets(contents),
        'utf8',
      );
      return nextConfig;
    },
  ]);
}

module.exports = withIosPodsDeploymentTarget;
module.exports.raiseDeploymentTargets = raiseDeploymentTargets;
module.exports.DEPLOYMENT_TARGET = DEPLOYMENT_TARGET;
module.exports.TV_DEPLOYMENT_TARGET = TV_DEPLOYMENT_TARGET;
module.exports.MARKER = MARKER;

// Xcode 27 refuses to build any target whose iOS deployment target is below
// 15. Some pods still declare an older minimum; ReachabilitySwift (pulled in
// by expo-updates) declares iOS 12, and React Native's post-install fix-up
// doesn't reach its resource bundle target. Raise every pod target that is
// below the app's minimum up to it.
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

// Expo SDK 55's minimum iOS version.
const MIN_IOS = '15.1';
const MARKER = '# withPodDeploymentTarget';

const snippet = `
    ${MARKER}
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_config|
        current = build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if current && current.to_f < ${MIN_IOS}
          build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${MIN_IOS}'
        end
      end
    end
`;

const addToPostInstall = podfile => {
  if (podfile.includes(MARKER)) return podfile;
  const hook = /post_install do \|installer\|\n/;
  if (!hook.test(podfile)) {
    throw new Error('withPodDeploymentTarget: no post_install block found in the Podfile');
  }
  return podfile.replace(hook, match => `${match}${snippet}`);
};

const withPodDeploymentTarget = config =>
  withDangerousMod(config, [
    'ios',
    async cfg => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      const podfile = fs.readFileSync(podfilePath, 'utf8');
      fs.writeFileSync(podfilePath, addToPostInstall(podfile));
      return cfg;
    },
  ]);

module.exports = withPodDeploymentTarget;
module.exports.addToPostInstall = addToPostInstall;

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('Android preview zip-aligns the release APK before signing it', () => {
  const yaml = readFileSync(resolve(__dirname, '../../../../codemagic.yaml'), 'utf8');
  const androidStart = yaml.indexOf('  android-preview:');
  const iosStart = yaml.indexOf('  ios-resignable-preview:');
  const android = yaml.slice(androidStart, iosStart);

  const zipalign = android.indexOf('"$BUILD_TOOLS/zipalign"');
  const sign = android.indexOf('"$APKSIGNER" sign');

  expect(zipalign).toBeGreaterThan(-1);
  expect(sign).toBeGreaterThan(zipalign);
});


test('native preview builds opt into cloudless preview mode', () => {
  const yaml = readFileSync(resolve(__dirname, '../../../../codemagic.yaml'), 'utf8');
  const androidStart = yaml.indexOf('  android-preview:');
  const iosStart = yaml.indexOf('  ios-resignable-preview:');
  const android = yaml.slice(androidStart, iosStart);
  const ios = yaml.slice(iosStart);

  expect(android).toContain('EXPO_PUBLIC_PREVIEW_MODE: "1"');
  expect(ios).toContain('EXPO_PUBLIC_PREVIEW_MODE: "1"');
});


test('Codemagic iOS preview selects the generated app shared scheme', () => {
  const yaml = readFileSync(resolve(__dirname, '../../../../codemagic.yaml'), 'utf8');
  const iosStart = yaml.indexOf('  ios-resignable-preview:');
  const tvosStart = yaml.indexOf('  tvos-resignable-preview:');
  const ios = yaml.slice(iosStart, tvosStart);

  expect(ios).toContain("! -name 'Pods.xcodeproj'");
  expect(ios).toContain('xcshareddata/xcschemes');
  expect(ios).toContain('SCHEME="$(basename "$SCHEME_FILE" .xcscheme)"');
  expect(ios).not.toContain('xcodebuild -workspace "$WORKSPACE" -list -json');
  expect(ios).toContain('-sdk iphoneos');
  expect(ios).toContain("-destination 'generic/platform=iOS'");
});


test('Codemagic exposes a re-signable Apple TV preview workflow', () => {
  const yaml = readFileSync(resolve(__dirname, '../../../../codemagic.yaml'), 'utf8');
  const tvosStart = yaml.indexOf('  tvos-resignable-preview:');
  const tvos = yaml.slice(tvosStart);

  expect(tvosStart).toBeGreaterThan(-1);
  expect(tvos).toContain('EXPO_TV: "1"');
  expect(tvos).toContain('-sdk appletvos');
  expect(tvos).toContain("-destination 'generic/platform=tvOS'");
  expect(tvos).toContain('Release-appletvos');
  expect(tvos).toContain("! -name 'Pods.xcodeproj'");
  expect(tvos).toContain('xcshareddata/xcschemes');
  expect(tvos).toContain('SCHEME="$(basename "$SCHEME_FILE" .xcscheme)"');
  expect(tvos).not.toContain('xcodebuild -workspace "$WORKSPACE" -list -json');
  expect(tvos).toContain('MoviesTv-Flix-tvos-resignable-preview.ipa');
  expect(tvos).toContain('scripts/verify-tvos-resignable.sh');
  expect(tvos).not.toContain('-sdk iphoneos');
});

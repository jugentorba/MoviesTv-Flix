import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('tvOS preview workflow builds an Apple TV device artifact', () => {
  const workflow = readFileSync(
    resolve(
      __dirname,
      '../../../../.github/workflows/tvos-resignable-preview.yml',
    ),
    'utf8',
  );

  expect(workflow).toContain('EXPO_TV: "1"');
  expect(workflow).toContain('-sdk appletvos');
  expect(workflow).toContain("-destination 'generic/platform=tvOS'");
  expect(workflow).toContain('Release-appletvos');
  expect(workflow).toContain("! -name 'Pods.xcodeproj'");
  expect(workflow).toContain('xcshareddata/xcschemes');
  expect(workflow).toContain('SCHEME="$(basename "$SCHEME_FILE" .xcscheme)"');
  expect(workflow).not.toContain('xcodebuild -workspace "$WORKSPACE" -list -json');
  expect(workflow).toContain(
    'MoviesTv-Flix-tvos-resignable-preview.ipa',
  );
  expect(workflow).not.toContain('-sdk iphoneos');
});

test('tvOS package verifier rejects non-tvOS application metadata', () => {
  const verifier = readFileSync(
    resolve(__dirname, '../../../../scripts/verify-tvos-resignable.sh'),
    'utf8',
  );

  expect(verifier).toContain("test \"$PLATFORM\" = 'appletvos'");
  expect(verifier).toContain("grep -q '3'");
  expect(verifier).toContain("grep -q 'arm64'");
  expect(verifier).toContain("test ! -d \"$APP/_CodeSignature\"");
});

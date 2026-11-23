import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('Android TV preview verifier checks TV launcher and touchscreen eligibility', () => {
  const verifier = readFileSync(
    resolve(__dirname, '../../../../scripts/verify-android-preview.sh'),
    'utf8',
  );

  expect(verifier).toContain('leanback-launchable-activity');
  expect(verifier).toContain('android.software.leanback');
  expect(verifier).toContain('android.hardware.touchscreen');
  expect(verifier).toContain('TARGET="${2:-phone}"');
});

test('GitHub Android preview verifies phone and TV artifacts with target-specific rules', () => {
  const workflow = readFileSync(
    resolve(__dirname, '../../../../.github/workflows/android-preview.yml'),
    'utf8',
  );

  expect(workflow).toContain("matrix.variant == 'android-tv'");
  expect(workflow).toContain('bash scripts/verify-android-preview.sh \\');
  expect(workflow).toContain('"$FINAL" \\');
  expect(workflow).toContain('"$TARGET" \\');
  expect(workflow).toContain('"$(git rev-parse --short=12 HEAD)"');
});

test('Codemagic Android workflows use target-specific APK verification', () => {
  const yaml = readFileSync(
    resolve(__dirname, '../../../../codemagic.yaml'),
    'utf8',
  );

  expect(yaml).toContain('verify-android-preview.sh "$FINAL" phone');
  expect(yaml).toContain('verify-android-preview.sh "$FINAL" tv');
});

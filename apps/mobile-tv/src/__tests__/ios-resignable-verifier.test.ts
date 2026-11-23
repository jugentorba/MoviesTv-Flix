import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('iOS re-signable verifier rejects non-iPhone platform metadata', () => {
  const verifier = readFileSync(
    resolve(__dirname, '../../../../scripts/verify-ios-resignable.sh'),
    'utf8',
  );

  expect(verifier).toContain("test \"$PLATFORM\" = 'iphoneos'");
  expect(verifier).toContain("grep -q '1'");
  expect(verifier).toContain('Unexpected Apple TV device family in iOS preview');
  expect(verifier).toContain("grep -q 'arm64'");
  expect(verifier).toContain('test ! -d "$APP/_CodeSignature"');
});

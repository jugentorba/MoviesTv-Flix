import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function workflow(name: string): string {
  return readFileSync(
    resolve(__dirname, '../../../../.github/workflows', name),
    'utf8',
  );
}

test.each([
  'android-preview.yml',
  'ios-resignable-preview.yml',
  'tvos-resignable-preview.yml',
])('%s can receive public Supabase config from repository variables', (name) => {
  const source = workflow(name);

  expect(source).toContain(
    'EXPO_PUBLIC_SUPABASE_URL: ${{ vars.EXPO_PUBLIC_SUPABASE_URL }}',
  );
  expect(source).toContain(
    'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ${{ vars.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY }}',
  );
  expect(source).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
});

test('iOS preview workflow selects the generated application shared scheme', () => {
  const source = workflow('ios-resignable-preview.yml');

  expect(source).toContain("! -name 'Pods.xcodeproj'");
  expect(source).toContain('xcshareddata/xcschemes');
  expect(source).toContain('SCHEME="$(basename "$SCHEME_FILE" .xcscheme)"');
  expect(source).not.toContain('xcodebuild -workspace "$WORKSPACE" -list -json');
  expect(source).toContain('-sdk iphoneos');
  expect(source).toContain("-destination 'generic/platform=iOS'");
});

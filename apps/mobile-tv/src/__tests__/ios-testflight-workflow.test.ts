import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('TestFlight workflow selects the application scheme instead of a Pods scheme', () => {
  const workflow = readFileSync(
    resolve(__dirname, '../../../../.github/workflows/ios-testflight.yml'),
    'utf8',
  );

  expect(workflow).toContain('not s.startswith("Pods-")');
  expect(workflow).toContain("-destination 'generic/platform=iOS'");
  expect(workflow).toContain('-archivePath "$IOS_ARCHIVE_PATH"');
});

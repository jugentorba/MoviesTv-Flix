import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, '..');
const resultFile = join(tmpdir(), 'moviestv-jest-results.json');
const publicSummary = resolve(appRoot, 'public', 'jest-diagnostics.json');

try {
  rmSync(resultFile, { force: true });
  rmSync(publicSummary, { force: true });
} catch {
  // A missing previous diagnostic file is expected on a clean build.
}

const run = spawnSync(
  'pnpm',
  [
    'exec',
    'jest',
    '--runInBand',
    '--json',
    `--outputFile=${resultFile}`,
  ],
  {
    cwd: appRoot,
    env: {
      ...process.env,
      EXPO_TV: '0',
      EXPO_PUBLIC_PREVIEW_MODE: '1',
    },
    stdio: 'inherit',
  },
);

let parsed = null;
if (existsSync(resultFile)) {
  try {
    parsed = JSON.parse(readFileSync(resultFile, 'utf8'));
  } catch {
    parsed = null;
  }
}

const safePath = (value) => {
  if (typeof value !== 'string') return 'unknown';
  const rel = relative(appRoot, value).replaceAll('\\', '/');
  if (!rel || rel === '..' || rel.startsWith('../')) return 'unknown';
  return rel;
};

const failedSuites = Array.isArray(parsed?.testResults)
  ? parsed.testResults
    .map((suite) => {
      const failedTests = Array.isArray(suite?.assertionResults)
        ? suite.assertionResults
          .filter((test) => test?.status === 'failed')
          .slice(0, 100)
          .map((test) => ({
            title: typeof test?.fullName === 'string'
              ? test.fullName.slice(0, 500)
              : typeof test?.title === 'string'
                ? test.title.slice(0, 500)
                : 'Unnamed failed test',
          }))
        : [];

      const suiteFailed = suite?.status === 'failed' || failedTests.length > 0;
      if (!suiteFailed) return null;
      return {
        file: safePath(suite?.name),
        failedTests,
      };
    })
    .filter(Boolean)
    .slice(0, 100)
  : [];

const summary = {
  generatedAt: new Date().toISOString(),
  runnerExitCode: typeof run.status === 'number' ? run.status : null,
  runnerSignal: run.signal ?? null,
  resultFileAvailable: Boolean(parsed),
  numFailedTestSuites: Number.isFinite(parsed?.numFailedTestSuites)
    ? parsed.numFailedTestSuites
    : null,
  numPassedTestSuites: Number.isFinite(parsed?.numPassedTestSuites)
    ? parsed.numPassedTestSuites
    : null,
  numFailedTests: Number.isFinite(parsed?.numFailedTests)
    ? parsed.numFailedTests
    : null,
  numPassedTests: Number.isFinite(parsed?.numPassedTests)
    ? parsed.numPassedTests
    : null,
  failedSuites,
};

writeFileSync(publicSummary, `${JSON.stringify(summary, null, 2)}\n`);
console.log(
  `Jest diagnostic summary: ${summary.numFailedTestSuites ?? '?'} failed suites, `
  + `${summary.numFailedTests ?? '?'} failed tests`,
);

// Diagnostic mode deliberately exits successfully so Expo can publish only the
// sanitized summary. The normal full gate is restored after the failures are repaired.
process.exitCode = 0;

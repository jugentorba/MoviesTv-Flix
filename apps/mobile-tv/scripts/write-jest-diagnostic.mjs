import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { relative } from 'node:path';

const [rawPath, outputPath] = process.argv.slice(2);
if (!rawPath || !outputPath) throw new Error('Expected raw Jest JSON path and output path');

const raw = JSON.parse(readFileSync(rawPath, 'utf8'));
const failingSuites = (raw.testResults ?? [])
  .map((suite) => {
    const tests = (suite.assertionResults ?? [])
      .filter((assertion) => assertion.status === 'failed')
      .map((assertion) => assertion.fullName || assertion.title)
      .filter(Boolean);
    if (!tests.length) return null;
    return {
      file: relative(process.cwd(), suite.name).replaceAll('\\', '/'),
      tests,
    };
  })
  .filter(Boolean);

writeFileSync(outputPath, JSON.stringify({
  numFailedTestSuites: raw.numFailedTestSuites ?? failingSuites.length,
  numFailedTests: raw.numFailedTests ?? failingSuites.reduce((sum, suite) => sum + suite.tests.length, 0),
  failingSuites,
}, null, 2) + '\n');
unlinkSync(rawPath);

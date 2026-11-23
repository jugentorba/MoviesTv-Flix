import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const storagePackage = JSON.parse(readFileSync(
  resolve(repoRoot, 'packages/storage/package.json'),
  'utf8',
));
const mobilePackage = JSON.parse(readFileSync(
  resolve(repoRoot, 'apps/mobile-tv/package.json'),
  'utf8',
));

assert.equal(
  storagePackage.dependencies?.['@react-native-async-storage/async-storage'],
  undefined,
  '@moviestv/storage must stay platform-neutral; AsyncStorage is injected by the app',
);

assert.equal(
  mobilePackage.dependencies?.react,
  '19.2.3',
  'Expo 56 targets React 19.2.3',
);
assert.equal(
  mobilePackage.dependencies?.['react-native'],
  'npm:react-native-tvos@0.85-stable',
  'Expo 56 TV builds require react-native-tvos 0.85-stable',
);
assert.equal(
  mobilePackage.devDependencies?.['@react-native-tvos/config-tv'],
  '^0.1.6',
  'TV prebuilds require the Expo TV config plugin',
);
assert.equal(
  mobilePackage.expo?.install?.exclude?.includes('react-native'),
  true,
  'Expo dependency validation must exclude the TV react-native alias',
);

const safeAreaRange =
  mobilePackage.dependencies?.['react-native-safe-area-context'] ?? '';
const screensRange =
  mobilePackage.dependencies?.['react-native-screens'] ?? '';
assert.match(
  safeAreaRange,
  /^\^5\.(?:[7-9]|\d{2,})\./,
  'Expo 56 safe-area dependency minimum must stay at 5.7 or newer',
);
assert.match(
  screensRange,
  /^\^4\.(?:2[6-9]|[3-9]\d|\d{3,})\./,
  'Expo 56 react-native-screens minimum must stay at 4.26 or newer',
);

// Workspace packages must be imported by name. A relative import that climbs out
// of the app resolves on this workstation but is not a declared dependency, so
// Metro and the app's own dependency list disagree about what the app needs.
const sourceFiles = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') {
        walk(path);
      }
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      sourceFiles.push(path);
    }
  }
}(resolve(repoRoot, 'apps/mobile-tv/src')));

const escaped = [];
const importedWorkspacePackages = new Set();
for (const file of sourceFiles) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/from\s+'((?:\.\.\/)+packages\/[^']+)'/g)) {
    escaped.push(`${file.slice(repoRoot.length + 1)} -> ${match[1]}`);
  }
  for (const match of source.matchAll(/from\s+'(@moviestv\/[a-z-]+)'/g)) {
    importedWorkspacePackages.add(match[1]);
  }
}

assert.deepEqual(
  escaped,
  [],
  'workspace packages must be imported by name, not through a relative path out of the app',
);

const undeclared = [...importedWorkspacePackages]
  .filter((name) => mobilePackage.dependencies?.[name] === undefined)
  .sort();
assert.deepEqual(
  undeclared,
  [],
  'every imported @moviestv/* package must be a declared app dependency',
);

console.log('workspace native dependency contract passed');

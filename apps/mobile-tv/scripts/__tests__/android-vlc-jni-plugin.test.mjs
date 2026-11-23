import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  addLibcxxSharedPickFirst,
} = require('../../plugins/withAndroidVlcJniLibs.js');

const buildGradle = `apply plugin: "com.android.application"

android {
    namespace 'com.jugentorba.moviestvflix'
}
`;

const patched = addLibcxxSharedPickFirst(buildGradle);

assert.match(
  patched,
  /pickFirsts\.add\('\*\*\/libc\+\+_shared\.so'\)/,
  'the plugin must pick one libc++_shared.so copy',
);
assert.match(
  patched,
  /android \{\s*\n {4}packaging \{\s*\n {8}jniLibs \{/,
  'the packaging rule must live in a Gradle android block',
);
assert.equal(
  addLibcxxSharedPickFirst(patched),
  patched,
  'the packaging rule must be idempotent',
);
assert.equal(
  patched.match(/pickFirsts\.add\('\*\*\/libc\+\+_shared\.so'\)/g).length,
  1,
  'only one pickFirst entry should be produced',
);
assert.throws(
  () => addLibcxxSharedPickFirst('// no android block'),
  /android\/app\/build\.gradle/,
);

console.log('PASS Android libvlc packaging plugin contract');

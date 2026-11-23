import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  GRADLE_VERSION,
  pinGradleDistribution,
} = require('../../plugins/withAndroidGradleWrapper.js');

const wrapper = `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-9.3.1-bin.zip
networkTimeout=10000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
`;

const pinned = pinGradleDistribution(wrapper);

assert.match(
  pinned,
  new RegExp(`^distributionUrl=https\\\\://services\\.gradle\\.org/distributions/gradle-${GRADLE_VERSION.replaceAll('.', '\\.')}-bin\\.zip$`, 'm'),
  'the wrapper must point at the pinned Gradle distribution',
);
assert.match(
  pinned,
  /^distributionBase=GRADLE_USER_HOME$/m,
  'the other wrapper settings must be preserved',
);
assert.equal(
  pinned.match(/^distributionUrl=.*$/gm).length,
  1,
  'only one distributionUrl line should remain',
);
assert.equal(
  pinGradleDistribution(pinned),
  pinned,
  'the pin must be idempotent',
);
assert.throws(
  () => pinGradleDistribution('// no distribution url'),
  /gradle-wrapper\.properties/,
);

console.log('PASS Android Gradle wrapper pin contract');

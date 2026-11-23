import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const workerPath = fileURLToPath(
  new URL('../../public/service-worker.js', import.meta.url),
);
const source = readFileSync(workerPath, 'utf8');
const listeners = new Map();

let releaseSkipWaiting;
const skipWaitingPromise = new Promise((resolve) => {
  releaseSkipWaiting = resolve;
});

let releaseClaim;
const claimPromise = new Promise((resolve) => {
  releaseClaim = resolve;
});

let skipWaitingCalls = 0;
let claimCalls = 0;
const deletedCaches = [];

const selfObject = {
  location: { origin: 'https://app.example' },
  addEventListener(type, listener) {
    listeners.set(type, listener);
  },
  skipWaiting() {
    skipWaitingCalls += 1;
    return skipWaitingPromise;
  },
  clients: {
    claim() {
      claimCalls += 1;
      return claimPromise;
    },
  },
};

const cachesObject = {
  async open() {
    return {
      async addAll() {},
      async put() {},
    };
  },
  async keys() {
    return [
      'moviestv-shell-old-build',
      'moviestv-shell-__MOVIESTV_BUILD_ID__',
    ];
  },
  async delete(key) {
    deletedCaches.push(key);
    return true;
  },
  async match() {
    return undefined;
  },
};

vm.runInNewContext(source, {
  self: selfObject,
  caches: cachesObject,
  URL,
  Response,
  fetch: async () => {
    throw new Error('network is not used by lifecycle tests');
  },
});

function lifecycleWait(type) {
  const listener = listeners.get(type);
  assert.equal(typeof listener, 'function', `missing ${type} listener`);

  let waitPromise;
  listener({
    waitUntil(promise) {
      waitPromise = Promise.resolve(promise);
    },
  });

  assert(waitPromise, `${type} did not call waitUntil`);
  return waitPromise;
}

async function expectPending(promise, label) {
  let settled = false;
  void promise.then(
    () => { settled = true; },
    () => { settled = true; },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, label);
}

const installWait = lifecycleWait('install');
assert.equal(skipWaitingCalls, 1);
await expectPending(
  installWait,
  'install waitUntil settled before skipWaiting completed',
);
releaseSkipWaiting();
await installWait;

const activateWait = lifecycleWait('activate');
assert.equal(claimCalls, 1);
await expectPending(
  activateWait,
  'activate waitUntil settled before clients.claim completed',
);
releaseClaim();
await activateWait;

assert.deepEqual(deletedCaches, ['moviestv-shell-old-build']);

console.log('service-worker lifecycle tests passed');

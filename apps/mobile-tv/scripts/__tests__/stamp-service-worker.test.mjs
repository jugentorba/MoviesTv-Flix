import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, '..', 'stamp-service-worker.mjs');

function fixture(
  indexHtml,
  workerSuffix = '',
  {
    manifest = '{"name":"MoviesTv-Flix"}',
    icon192 = 'icon-192-a',
    icon512 = 'icon-512-a',
    assetContent = 'console.log("bundle-a");',
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'moviestv-sw-'));
  writeFileSync(join(root, 'index.html'), indexHtml);
  writeFileSync(join(root, 'manifest.webmanifest'), manifest);
  writeFileSync(join(root, 'icon-192.png'), icon192);
  writeFileSync(join(root, 'icon-512.png'), icon512);
  writeFileSync(
    join(root, 'service-worker.js'),
    [
      "const CACHE = 'moviestv-shell-__MOVIESTV_BUILD_ID__';",
      'const SHELL = [',
      "  '/',",
      '  /* __MOVIESTV_SHELL_ASSETS__ */',
      '];',
      workerSuffix,
    ].join('\n'),
  );

  const referencedAssets = [...indexHtml.matchAll(
    /\b(?:src|href)=["'](\/[^"'?#]+\.(?:js|css))(?:[?#][^"']*)?["']/gi,
  )].map((match) => match[1]);
  for (const assetPath of referencedAssets) {
    const relative = assetPath.replace(/^\/+/, '');
    const directory = dirname(join(root, relative));
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(root, relative), assetContent);
  }
  return root;
}

function stamp(root) {
  execFileSync(process.execPath, [script, root], { stdio: 'pipe' });
  return readFileSync(join(root, 'service-worker.js'), 'utf8');
}

const first = fixture('<html><script src="/assets/app-aaa.js"></script></html>');
const second = fixture('<html><script src="/assets/app-aaa.js"></script></html>');
const changed = fixture('<html><script src="/assets/app-bbb.js"></script></html>');
const workerChanged = fixture(
  '<html><script src="/assets/app-aaa.js"></script></html>',
  'self.addEventListener("activate", () => {});\n',
);
const manifestChanged = fixture(
  '<html><script src="/assets/app-aaa.js"></script></html>',
  '',
  { manifest: '{"name":"MoviesTv-Flix Updated"}' },
);
const iconChanged = fixture(
  '<html><script src="/assets/app-aaa.js"></script></html>',
  '',
  { icon192: 'icon-192-b' },
);
const assetChanged = fixture(
  '<html><script src="/assets/app-aaa.js"></script></html>',
  '',
  { assetContent: 'console.log("bundle-b");' },
);
const missingAsset = fixture(
  '<html><script src="/assets/app-missing.js"></script></html>',
);
rmSync(join(missingAsset, 'assets', 'app-missing.js'));

try {
  const firstOutput = stamp(first);
  const secondOutput = stamp(second);
  const changedOutput = stamp(changed);
  const workerChangedOutput = stamp(workerChanged);
  const manifestChangedOutput = stamp(manifestChanged);
  const iconChangedOutput = stamp(iconChanged);
  const assetChangedOutput = stamp(assetChanged);
  assert.throws(
    () => stamp(missingAsset),
    /index\.html references missing shell asset/,
  );

  assert(!firstOutput.includes('__MOVIESTV_BUILD_ID__'));
  assert(!firstOutput.includes('__MOVIESTV_SHELL_ASSETS__'));
  assert(firstOutput.includes('"/assets/app-aaa.js"'));

  const firstId = firstOutput.match(/moviestv-shell-([a-f0-9]{16})/)?.[1];
  const secondId = secondOutput.match(/moviestv-shell-([a-f0-9]{16})/)?.[1];
  const changedId = changedOutput.match(/moviestv-shell-([a-f0-9]{16})/)?.[1];
  const workerChangedId = workerChangedOutput
    .match(/moviestv-shell-([a-f0-9]{16})/)?.[1];
  const manifestChangedId = manifestChangedOutput
    .match(/moviestv-shell-([a-f0-9]{16})/)?.[1];
  const iconChangedId = iconChangedOutput
    .match(/moviestv-shell-([a-f0-9]{16})/)?.[1];
  const assetChangedId = assetChangedOutput
    .match(/moviestv-shell-([a-f0-9]{16})/)?.[1];

  const stampedIndex = readFileSync(join(first, 'index.html'), 'utf8');
  const pageId = stampedIndex.match(
    /<meta\s+name=["']moviestv-build-id["']\s+content=["']([a-f0-9]{16})["']\s*\/?\s*>/i,
  )?.[1];

  assert(firstId, 'expected a stamped build cache id');
  assert.equal(
    pageId,
    firstId,
    'running page build meta must match the service-worker cache id',
  );
  assert.equal(firstId, secondId, 'same web export should stamp the same cache id');
  assert.notEqual(firstId, changedId, 'changed web export must stamp a new cache id');
  assert.notEqual(
    firstId,
    workerChangedId,
    'changed service worker must stamp a new cache id',
  );
  assert.notEqual(
    firstId,
    manifestChangedId,
    'changed manifest must stamp a new cache id',
  );
  assert.notEqual(
    firstId,
    iconChangedId,
    'changed shell artwork must stamp a new cache id',
  );
  assert.notEqual(
    firstId,
    assetChangedId,
    'changed entry bundle content must stamp a new cache id',
  );

  console.log('service-worker build stamping tests passed');
} finally {
  rmSync(first, { recursive: true, force: true });
  rmSync(second, { recursive: true, force: true });
  rmSync(changed, { recursive: true, force: true });
  rmSync(workerChanged, { recursive: true, force: true });
  rmSync(manifestChanged, { recursive: true, force: true });
  rmSync(iconChanged, { recursive: true, force: true });
  rmSync(assetChanged, { recursive: true, force: true });
  rmSync(missingAsset, { recursive: true, force: true });
}

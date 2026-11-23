import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? 'dist');
const indexPath = join(root, 'index.html');
const workerPath = join(root, 'service-worker.js');
const shellAssetNames = [
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
];

const indexHtml = readFileSync(indexPath);
const indexText = indexHtml.toString('utf8');
const worker = readFileSync(workerPath, 'utf8');

const referencedShellAssets = [...indexText.matchAll(
  /\b(?:src|href)=["'](\/[^"'?#]+\.(?:js|css))(?:[?#][^"']*)?["']/gi,
)]
  .map((match) => match[1])
  .filter((value, index, list) => list.indexOf(value) === index)
  .sort();

for (const assetPath of referencedShellAssets) {
  const filePath = join(root, assetPath.replace(/^\/+/, ''));
  if (!existsSync(filePath)) {
    throw new Error(`index.html references missing shell asset: ${assetPath}`);
  }
}

const hash = createHash('sha256')
  .update('index.html\0')
  .update(indexHtml)
  .update('\0service-worker.js\0')
  .update(worker);

for (const assetName of shellAssetNames) {
  hash
    .update(`\0${assetName}\0`)
    .update(readFileSync(join(root, assetName)));
}

for (const assetPath of referencedShellAssets) {
  hash
    .update(`\0${assetPath}\0`)
    .update(readFileSync(join(root, assetPath.replace(/^\/+/, ''))));
}

const buildId = hash
  .digest('hex')
  .slice(0, 16);

const buildMeta =
  `<meta name="moviestv-build-id" content="${buildId}">`;
const existingBuildMeta =
  /<meta\s+[^>]*name=["']moviestv-build-id["'][^>]*>/i;
let stampedIndexText;
if (existingBuildMeta.test(indexText)) {
  stampedIndexText = indexText.replace(existingBuildMeta, buildMeta);
} else if (/<\/head>/i.test(indexText)) {
  stampedIndexText = indexText.replace(/<\/head>/i, `${buildMeta}</head>`);
} else if (/<html(?:\s[^>]*)?>/i.test(indexText)) {
  stampedIndexText = indexText.replace(
    /<html(?:\s[^>]*)?>/i,
    (htmlTag) => `${htmlTag}<head>${buildMeta}</head>`,
  );
} else {
  stampedIndexText = `${buildMeta}${indexText}`;
}

if (!worker.includes('__MOVIESTV_BUILD_ID__')) {
  throw new Error('service-worker.js is missing __MOVIESTV_BUILD_ID__ placeholder');
}
if (!worker.includes('/* __MOVIESTV_SHELL_ASSETS__ */')) {
  throw new Error('service-worker.js is missing shell-asset placeholder');
}

const stampedShellAssets = referencedShellAssets
  .map((assetPath) => `  ${JSON.stringify(assetPath)},`)
  .join('\n');

writeFileSync(indexPath, stampedIndexText);

writeFileSync(
  workerPath,
  worker
    .replace('  /* __MOVIESTV_SHELL_ASSETS__ */', stampedShellAssets)
    .replaceAll('__MOVIESTV_BUILD_ID__', buildId),
);

console.log(`Stamped PWA cache build id: ${buildId}`);

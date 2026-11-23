import {
  buildStremioConfiguredManifestUrl,
  stremioPublicBaseManifestUrl,
} from '../stremio-config';

test('adds encoded JSON configuration before manifest.json', () => {
  const url = buildStremioConfiguredManifestUrl(
    'https://example.com/manifest.json',
    { language: 'fr-FR', region: 'FR' },
  );

  expect(decodeURIComponent(url)).toBe(
    'https://example.com/{"language":"fr-FR","region":"FR"}/manifest.json',
  );
});

test('preserves a mounted addon path', () => {
  const url = buildStremioConfiguredManifestUrl(
    'https://example.com/addon/manifest.json',
    { language: 'en-US' },
  );

  expect(decodeURIComponent(url)).toBe(
    'https://example.com/addon/{"language":"en-US"}/manifest.json',
  );
});

test('replaces an existing standard JSON config segment', () => {
  const original = buildStremioConfiguredManifestUrl(
    'https://example.com/addon/manifest.json',
    { language: 'en-US' },
  );
  const updated = buildStremioConfiguredManifestUrl(
    original,
    { language: 'fr-FR', region: 'FR' },
  );

  expect(decodeURIComponent(updated)).toBe(
    'https://example.com/addon/{"language":"fr-FR","region":"FR"}/manifest.json',
  );
});


test('recovers the public base manifest from a standard configured URL', () => {
  const configured = buildStremioConfiguredManifestUrl(
    'https://example.com/addon/manifest.json',
    { language: 'fr-FR', region: 'FR' },
  );

  expect(stremioPublicBaseManifestUrl(configured)).toBe(
    'https://example.com/addon/manifest.json',
  );
});

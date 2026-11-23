import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { APP_RESOURCES, SUPPORTED_APP_LOCALES } from '../resources';
import { SCREEN_PACKS, SCREEN_RESOURCE_KEYS } from '../resources/screens';
import type { TranslationTree } from '../types';

/**
 * Guards the resource packs themselves rather than any one screen.
 *
 * `translateFrom` falls back to English and then to the key, which keeps the app
 * usable when a translation is missing but hides the gap from every screen test.
 * These assertions make the gap loud: a key that no locale defines, a locale
 * that lost a value, or a translation that dropped a `{count}` token fails here.
 */

type FlatResource = Record<string, string>;

function flatten(tree: TranslationTree, prefix = '', out: FlatResource = {}): FlatResource {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out[path] = value;
      continue;
    }
    if (value && typeof value === 'object') {
      flatten(value, path, out);
    }
  }
  return out;
}

function placeholders(value: string): string {
  return [...value.matchAll(/\{(\w+)\}/g)]
    .map((match) => match[1])
    .sort()
    .join(',');
}

const ENGLISH = flatten(APP_RESOURCES.en as TranslationTree);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') {
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(path, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

test('every literal t() key in src resolves in the English resource', () => {
  const appRoot = join(__dirname, '..', '..', '..');
  const keys = new Set<string>();
  for (const file of sourceFiles(join(appRoot, 'src'))) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bt\('([A-Za-z0-9_.-]+)'/g)) {
      keys.add(match[1]);
    }
  }

  // A vanishingly small number would mean the scan stopped matching t() calls.
  expect(keys.size).toBeGreaterThan(200);
  const missing = [...keys].filter((key) => ENGLISH[key] === undefined).sort();
  expect(missing).toEqual([]);
});

test('every supported locale builds the full English key set with no empty value', () => {
  const englishKeys = Object.keys(ENGLISH).sort();

  for (const locale of SUPPORTED_APP_LOCALES) {
    const flat = flatten(APP_RESOURCES[locale] as TranslationTree);
    expect({ locale, missing: englishKeys.filter((key) => flat[key] === undefined) })
      .toEqual({ locale, missing: [] });

    const empty = Object.entries(flat)
      .filter(([, value]) => value.trim() === '')
      .map(([key]) => key);
    expect({ locale, empty }).toEqual({ locale, empty: [] });
  }
});

test('a translated string keeps the placeholder tokens of its English source', () => {
  const drifted: string[] = [];

  for (const locale of SUPPORTED_APP_LOCALES) {
    if (locale === 'en') {
      continue;
    }
    const flat = flatten(APP_RESOURCES[locale] as TranslationTree);
    for (const [key, value] of Object.entries(flat)) {
      const expected = placeholders(ENGLISH[key] ?? '');
      if (placeholders(value) !== expected) {
        drifted.push(`${locale} ${key}: {${placeholders(value)}} != {${expected}}`);
      }
    }
  }

  expect(drifted).toEqual([]);
});

test('the screens pack is translated, not just English under other locale names', () => {
  // The `screens` pack is what PR #56–#62 migrated. A locale that kept the English
  // values would pass every screen test while showing English in the app, so count
  // the strings that actually differ from English.
  expect(SCREEN_RESOURCE_KEYS).toHaveLength(399);

  for (const locale of ['sq', 'fr', 'de']) {
    const pack = SCREEN_PACKS[locale];
    expect({ locale, length: pack.length }).toEqual({ locale, length: SCREEN_RESOURCE_KEYS.length });

    const translated = pack.filter((value, index) => value !== SCREEN_PACKS.en[index]).length;
    expect({ locale, translatedAtLeast200: translated >= 200 }).toEqual({ locale, translatedAtLeast200: true });
  }

  // Spot-check that a translated screen title reaches the built resource tree.
  expect(flatten(APP_RESOURCES.de as TranslationTree)['liveTvGuide.title']).toBe('Programmübersicht');
});

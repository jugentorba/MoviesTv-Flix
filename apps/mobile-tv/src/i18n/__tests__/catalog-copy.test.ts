import { APP_RESOURCES } from '../resources';
import type { TranslationTree } from '../types';

function read(tree: TranslationTree, path: string): string | undefined {
  let current: string | TranslationTree = tree;
  for (const part of path.split('.')) {
    if (typeof current === 'string') return undefined;
    const next: string | TranslationTree | undefined = current[part];
    if (!next) return undefined;
    current = next;
  }
  return typeof current === 'string' ? current : undefined;
}

test('catalog/search/detail functional copy is localized for priority locales', () => {
  expect(read(APP_RESOURCES.fr, 'common.details')).toBe('Détails');
  expect(read(APP_RESOURCES.sq, 'common.cast')).toBe('Aktorët');
  expect(read(APP_RESOURCES.ar, 'search.placeholder')).toBe('ابحث عن أفلام أو مسلسلات');
  expect(read(APP_RESOURCES.de, 'details.playUnavailable')).toBe('Wiedergabe nicht verfügbar');
});

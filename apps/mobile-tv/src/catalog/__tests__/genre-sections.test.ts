import type { CatalogSection } from '@moviestv/catalog';
import {
  filterCatalogSections,
  genreOfSection,
  genreSectionsFor,
  isGenreSection,
} from '../catalog-view-model';

const section = (id: string, title: string): CatalogSection => ({
  id,
  title,
  kinds: ['movie'],
});

test('a genre section is recognised from the provider id', () => {
  const genre = section('movies:com.linvo.cinemeta:top:genre:Action', 'Popular · Action');
  expect(genreOfSection(genre)).toBe('Action');
  expect(isGenreSection(genre)).toBe(true);
  expect(genreOfSection(section('movies:x:top', 'Popular'))).toBeNull();
});

test('genre sections are not home rows', () => {
  const rows = filterCatalogSections('movies', [
    section('movies:x:top', 'Popular'),
    section('movies:x:top:genre:Action', 'Popular · Action'),
    section('series:x:top', 'Popular series'),
  ]);
  expect(rows.map((row) => row.id)).toEqual(['movies:x:top']);
});

test('genres are collected per tab, de-duplicated, in provider order', () => {
  const options = genreSectionsFor('movies', [
    section('movies:x:top:genre:Action', 'Popular · Action'),
    section('movies:x:top:genre:Comedy', 'Popular · Comedy'),
    section('movies:x:year:genre:Action', 'New · Action'),
    section('series:x:top:genre:Action', 'Series · Action'),
  ]);
  expect(options.map((option) => option.genre)).toEqual(['Action', 'Comedy']);
});

test('a malformed genre id is ignored instead of throwing', () => {
  expect(genreOfSection(section('movies:x:top:genre:%E0%A4%A', 'broken'))).toBeNull();
});

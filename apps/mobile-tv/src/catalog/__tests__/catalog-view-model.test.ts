import { filterCatalogSections } from '../catalog-view-model';

function loadModule(path: string): Record<string, unknown> {
  try {
    return require(path) as Record<string, unknown>;
  } catch {
    return {};
  }
}

type Section = { id: string; title: string; kinds: ('movie' | 'series')[] };
type Row = { section: Section; items: { id: string; kind: 'movie' | 'series'; title: string }[] };

describe('catalog screen view model', () => {
  const sections: Section[] = [
    { id: 'home:trending-movies', title: 'Trending Movies', kinds: ['movie'] },
    { id: 'home:trending-series', title: 'Trending Series', kinds: ['series'] },
    { id: 'movies:popular', title: 'Popular Movies', kinds: ['movie'] },
    { id: 'series:popular', title: 'Popular Series', kinds: ['series'] },
  ];

  it('filters sections for Home, Movies and Series without mixing destinations', () => {
    const mod = loadModule('../catalog-view-model');
    const filterCatalogSections = mod.filterCatalogSections as undefined | ((route: string, input: Section[]) => Section[]);
    expect(filterCatalogSections).toBeDefined();
    expect(filterCatalogSections?.('home', sections).map((section) => section.id)).toEqual([
      'home:trending-movies',
      'home:trending-series',
    ]);
    expect(filterCatalogSections?.('movies', sections).map((section) => section.id)).toEqual(['movies:popular']);
    expect(filterCatalogSections?.('series', sections).map((section) => section.id)).toEqual(['series:popular']);
  });

  it('returns loading while a destination is still fetching', () => {
    const mod = loadModule('../catalog-view-model');
    const getCatalogViewState = mod.getCatalogViewState as undefined | ((input: unknown) => string);
    expect(getCatalogViewState).toBeDefined();
    expect(getCatalogViewState?.({ loading: true, error: null, rows: [] })).toBe('loading');
  });

  it('returns content when at least one row has items even if another row is empty', () => {
    const mod = loadModule('../catalog-view-model');
    const getCatalogViewState = mod.getCatalogViewState as undefined | ((input: unknown) => string);
    expect(getCatalogViewState).toBeDefined();
    const rows: Row[] = [
      { section: sections[0], items: [] },
      { section: sections[1], items: [{ id: 'demo:series:1', kind: 'series', title: 'One' }] },
    ];
    expect(getCatalogViewState?.({ loading: false, error: null, rows })).toBe('content');
  });

  it('returns empty when loading finished successfully with no visible items', () => {
    const mod = loadModule('../catalog-view-model');
    const getCatalogViewState = mod.getCatalogViewState as undefined | ((input: unknown) => string);
    expect(getCatalogViewState).toBeDefined();
    expect(getCatalogViewState?.({ loading: false, error: null, rows: [] })).toBe('empty');
  });

  it('returns error only when there is no content to keep showing', () => {
    const mod = loadModule('../catalog-view-model');
    const getCatalogViewState = mod.getCatalogViewState as undefined | ((input: unknown) => string);
    expect(getCatalogViewState).toBeDefined();
    expect(getCatalogViewState?.({ loading: false, error: 'Offline', rows: [] })).toBe('error');
    const rows: Row[] = [{ section: sections[0], items: [{ id: 'demo:movie:1', kind: 'movie', title: 'Cached' }] }];
    expect(getCatalogViewState?.({ loading: false, error: 'Offline', rows })).toBe('content');
  });
});


test('filters duplicate and malformed catalog sections', () => {
  const sections = [
    { id: 'movies:popular', title: 'Popular', kinds: ['movie'] },
    { id: 'movies:popular', title: 'Duplicate', kinds: ['movie'] },
    { id: ' ', title: 'Bad', kinds: ['movie'] },
    { id: 'series:popular', title: 'Series', kinds: ['series'] },
  ] as Section[];
  expect(filterCatalogSections('movies', sections).map((section) => section.id)).toEqual(['movies:popular']);
});

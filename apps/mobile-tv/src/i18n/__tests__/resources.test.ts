import { APP_RESOURCES, SUPPORTED_APP_LOCALES } from '../resources';

function keysOf(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [prefix];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    keysOf(child, prefix ? `${prefix}.${key}` : key),
  );
}

function detailsCopy(locale: keyof typeof APP_RESOURCES, key: string): string | undefined {
  const details = APP_RESOURCES[locale].details as Record<string, unknown>;
  const value = details[key];
  return typeof value === 'string' ? value : undefined;
}

test('ships the approved broad first-pass app locale set', () => {
  expect(SUPPORTED_APP_LOCALES).toEqual([
    'en', 'sq', 'fr', 'de', 'it', 'es', 'pt-BR', 'pt-PT', 'tr', 'nl', 'pl', 'ro',
    'cs', 'sk', 'hu', 'sv', 'da', 'fi', 'no', 'el', 'bg', 'hr', 'bs', 'sr-Latn',
    'sl', 'mk', 'ru', 'uk', 'ar', 'he', 'fa', 'hi', 'bn', 'ur', 'id', 'ms', 'vi',
    'th', 'zh-Hans', 'zh-Hant', 'ja', 'ko',
  ]);
  expect(SUPPORTED_APP_LOCALES).toHaveLength(42);
});

test('every exposed locale contains every English baseline key', () => {
  const baselineKeys = keysOf(APP_RESOURCES.en).sort();
  expect(baselineKeys.length).toBeGreaterThan(20);

  for (const locale of SUPPORTED_APP_LOCALES) {
    expect(keysOf(APP_RESOURCES[locale]).sort()).toEqual(baselineKeys);
  }
});

test('English baseline covers navigation and language settings', () => {
  expect(APP_RESOURCES.en.nav.home).toBe('Home');
  expect(APP_RESOURCES.en.settings.appLanguage).toBe('App language');
  expect(APP_RESOURCES.en.settings.audioLanguages).toBe('Preferred audio languages');
  expect(APP_RESOURCES.en.settings.subtitleLanguages).toBe('Preferred subtitle languages');
});

test('episode browser ships first-party English, Albanian, French and German copy', () => {
  expect([
    detailsCopy('en', 'season'),
    detailsCopy('en', 'episode'),
    detailsCopy('en', 'episodes'),
    detailsCopy('en', 'loadingEpisodes'),
    detailsCopy('en', 'noEpisodes'),
    detailsCopy('en', 'loadEpisodesFailed'),
  ]).toEqual([
    'Season', 'Episode', 'Episodes', 'Loading episodes…', 'No episodes available', "Couldn't load episodes",
  ]);
  expect([
    detailsCopy('sq', 'season'),
    detailsCopy('sq', 'episode'),
    detailsCopy('sq', 'episodes'),
    detailsCopy('sq', 'loadingEpisodes'),
    detailsCopy('sq', 'noEpisodes'),
    detailsCopy('sq', 'loadEpisodesFailed'),
  ]).toEqual([
    'Sezoni', 'Episodi', 'Episodet', 'Duke ngarkuar episodet…', 'Nuk ka episode të disponueshme', 'Episodet nuk mund të ngarkoheshin',
  ]);
  expect([
    detailsCopy('fr', 'season'),
    detailsCopy('fr', 'episode'),
    detailsCopy('fr', 'episodes'),
    detailsCopy('fr', 'loadingEpisodes'),
    detailsCopy('fr', 'noEpisodes'),
    detailsCopy('fr', 'loadEpisodesFailed'),
  ]).toEqual([
    'Saison', 'Épisode', 'Épisodes', 'Chargement des épisodes…', 'Aucun épisode disponible', 'Impossible de charger les épisodes',
  ]);
  expect([
    detailsCopy('de', 'season'),
    detailsCopy('de', 'episode'),
    detailsCopy('de', 'episodes'),
    detailsCopy('de', 'loadingEpisodes'),
    detailsCopy('de', 'noEpisodes'),
    detailsCopy('de', 'loadEpisodesFailed'),
  ]).toEqual([
    'Staffel', 'Folge', 'Folgen', 'Folgen werden geladen…', 'Keine Folgen verfügbar', 'Folgen konnten nicht geladen werden',
  ]);
});

test('non-priority locales fall back to English episode copy', () => {
  expect([
    detailsCopy('it', 'season'),
    detailsCopy('it', 'episode'),
    detailsCopy('it', 'episodes'),
    detailsCopy('it', 'loadingEpisodes'),
    detailsCopy('it', 'noEpisodes'),
    detailsCopy('it', 'loadEpisodesFailed'),
  ]).toEqual([
    'Season', 'Episode', 'Episodes', 'Loading episodes…', 'No episodes available', "Couldn't load episodes",
  ]);
});


function liveTvCopy(locale: keyof typeof APP_RESOURCES, key: string): string | undefined {
  const liveTv = APP_RESOURCES[locale].liveTv as Record<string, unknown>;
  const value = liveTv[key];
  return typeof value === 'string' ? value : undefined;
}

test('Live TV ships first-party English, Albanian, French and German copy', () => {
  expect([
    liveTvCopy('en', 'searchChannels'),
    liveTvCopy('en', 'noProvider'),
    liveTvCopy('en', 'nextChannel'),
    liveTvCopy('en', 'guideUnavailable'),
  ]).toEqual([
    'Search channels',
    'No Live TV provider is installed',
    'Next channel',
    'Programme guide unavailable',
  ]);
  expect([
    liveTvCopy('sq', 'searchChannels'),
    liveTvCopy('sq', 'noProvider'),
    liveTvCopy('sq', 'nextChannel'),
    liveTvCopy('sq', 'guideUnavailable'),
  ]).toEqual([
    'Kërko kanale',
    'Nuk ka asnjë ofrues Live TV të instaluar',
    'Kanali tjetër',
    'Guida e programeve nuk është e disponueshme',
  ]);
  expect([
    liveTvCopy('fr', 'searchChannels'),
    liveTvCopy('fr', 'noProvider'),
    liveTvCopy('fr', 'nextChannel'),
    liveTvCopy('fr', 'guideUnavailable'),
  ]).toEqual([
    'Rechercher des chaînes',
    'Aucun fournisseur de TV en direct n’est installé',
    'Chaîne suivante',
    'Guide des programmes indisponible',
  ]);
  expect([
    liveTvCopy('de', 'searchChannels'),
    liveTvCopy('de', 'noProvider'),
    liveTvCopy('de', 'nextChannel'),
    liveTvCopy('de', 'guideUnavailable'),
  ]).toEqual([
    'Sender suchen',
    'Kein Live-TV-Anbieter ist installiert',
    'Nächster Sender',
    'Programmführer nicht verfügbar',
  ]);
});

test('non-priority locales fall back to English Live TV copy', () => {
  expect([liveTvCopy('it', 'searchChannels'), liveTvCopy('it', 'noProvider'), liveTvCopy('it', 'nextChannel')])
    .toEqual(['Search channels', 'No Live TV provider is installed', 'Next channel']);
});

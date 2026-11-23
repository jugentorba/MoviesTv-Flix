export const EPISODE_RESOURCE_KEYS = [
  'details.season',
  'details.episode',
  'details.episodes',
  'details.loadingEpisodes',
  'details.noEpisodes',
  'details.loadEpisodesFailed',
] as const;

const english = [
  'Season',
  'Episode',
  'Episodes',
  'Loading episodes…',
  'No episodes available',
  "Couldn't load episodes",
] as const;

export const EPISODE_PACKS: Record<string, readonly string[]> = {
  en: english,
  sq: [
    'Sezoni',
    'Episodi',
    'Episodet',
    'Duke ngarkuar episodet…',
    'Nuk ka episode të disponueshme',
    'Episodet nuk mund të ngarkoheshin',
  ],
  fr: [
    'Saison',
    'Épisode',
    'Épisodes',
    'Chargement des épisodes…',
    'Aucun épisode disponible',
    'Impossible de charger les épisodes',
  ],
  de: [
    'Staffel',
    'Folge',
    'Folgen',
    'Folgen werden geladen…',
    'Keine Folgen verfügbar',
    'Folgen konnten nicht geladen werden',
  ],
};

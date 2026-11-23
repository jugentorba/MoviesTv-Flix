export type TranslationNode = string | TranslationTree;

export interface TranslationTree {
  [key: string]: TranslationNode;
}

type TranslationSection<T extends Record<string, string>> = TranslationTree & T;

export interface AppTranslationResource extends TranslationTree {
  nav: TranslationSection<{
    home: string;
    movies: string;
    series: string;
    liveTv: string;
    search: string;
    settings: string;
  }>;
  settings: TranslationSection<{
    title: string;
    appLanguage: string;
    audioLanguages: string;
    subtitleLanguages: string;
    followDevice: string;
    subtitlesEnabled: string;
    moveUp: string;
    moveDown: string;
    remove: string;
    languageSearch: string;
  }>;
  common: TranslationSection<{
    back: string;
    retry: string;
    loading: string;
    save: string;
    cancel: string;
    unavailable: string;
    noResults: string;
    details: string;
    cast: string;
    catalog: string;
    provider: string;
    seasons: string;
    minutes: string;
    demo: string;
    live: string;
    featured: string;
    movie: string;
    series: string;
  }>;
  auth: TranslationSection<{
    email: string;
    password: string;
    signIn: string;
    backendNotConfigured: string;
  }>;
  search: TranslationSection<{
    placeholder: string;
    minChars: string;
    searching: string;
    tryDifferent: string;
    results: string;
    loadMore: string;
  }>;
  details: TranslationSection<{
    noOverview: string;
    playUnavailable: string;
    season: string;
    episode: string;
    episodes: string;
    loadingEpisodes: string;
    noEpisodes: string;
    loadEpisodesFailed: string;
  }>;
  liveTv: TranslationSection<{
    title: string;
    searchChannels: string;
    allCountries: string;
    refresh: string;
    loadingChannels: string;
    noProvider: string;
    noChannels: string;
    partialFailure: string;
    allProvidersFailed: string;
    selectChannel: string;
    channelUnavailable: string;
    retry: string;
    previousChannel: string;
    nextChannel: string;
    playlistTruncated: string;
  }>;
  watchHistory: TranslationSection<{
    back: string;
    eyebrow: string;
    title: string;
    subtitle: string;
    empty: string;
    remove: string;
    removeLabel: string;
    clearAll: string;
    confirmClear: string;
    cancelClear: string;
    clearDone: string;
    removeDone: string;
    completed: string;
    watched: string;
    resumeFailed: string;
    syncing: string;
    offline: string;
    error: string;
  }>;
  library: TranslationSection<{
    title: string;
    subtitle: string;
    myList: string;
    downloads: string;
    history: string;
    empty: string;
  }>;
}

export type LayoutDirection = 'ltr' | 'rtl';

/** Values substituted into `{placeholder}` tokens in a translated string. */
export type TranslationParams = Record<string, string | number>;

export interface I18nApi {
  locale: string;
  direction: LayoutDirection;
  /**
   * Translates `key` for the current locale and substitutes `{name}` tokens.
   * An unknown key falls back to English, then to the key itself.
   */
  t(key: string, params?: TranslationParams): string;
  formatNumber(value: number): string;
  formatDate(value: Date | number): string;
  languageName(tag: string): string;
}

import type { ProviderKind } from './AddProviderScreen';

/**
 * Two public manifests that make a fresh install usable without typing a URL.
 *
 * Both were fetched and checked before being listed here:
 *   Cinemeta           com.linvo.cinemeta             catalog + meta, movie/series
 *   OpenSubtitles v3   org.stremio.opensubtitlesv3    subtitles, movie/series
 *
 * Deliberately no stream/scraper add-ons: those carry legal and safety
 * questions the app should not answer for the user.
 */
export interface QuickstartAddon {
  /** Manifest id, also used to detect an existing install. */
  id: string;
  kind: ProviderKind;
  url: string;
  titleKey: string;
  detailKey: string;
  icon: 'film-outline' | 'text-outline';
}

export const QUICKSTART_ADDONS: readonly QuickstartAddon[] = [
  {
    id: 'com.linvo.cinemeta',
    kind: 'catalog',
    url: 'https://v3-cinemeta.strem.io/manifest.json',
    titleKey: 'quickstart.cinemeta',
    detailKey: 'quickstart.cinemetaDetail',
    icon: 'film-outline',
  },
  {
    id: 'org.stremio.opensubtitlesv3',
    kind: 'stream',
    url: 'https://opensubtitles-v3.strem.io/manifest.json',
    titleKey: 'quickstart.opensubtitles',
    detailKey: 'quickstart.opensubtitlesDetail',
    icon: 'text-outline',
  },
];

export function quickstartFor(kind: ProviderKind): QuickstartAddon[] {
  return QUICKSTART_ADDONS.filter((addon) => addon.kind === kind);
}

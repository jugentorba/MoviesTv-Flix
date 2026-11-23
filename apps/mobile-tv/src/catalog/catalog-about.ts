export interface CatalogAboutInfo {
  modeLabel: string;
  usesTmdb: boolean;
  attribution?: string;
}

const TMDB_ATTRIBUTION = 'This product uses the TMDB API but is not endorsed or certified by TMDB.';

export function getCatalogAboutInfo(mode: 'installed' | 'demo' | 'remote'): CatalogAboutInfo {
  if (mode === 'remote') {
    return {
      modeLabel: 'TMDB catalog',
      usesTmdb: true,
      attribution: TMDB_ATTRIBUTION,
    };
  }

  if (mode === 'installed') {
    return {
      modeLabel: 'User-installed catalogs',
      usesTmdb: false,
    };
  }

  return {
    modeLabel: 'Demo catalog',
    usesTmdb: false,
  };
}

export {};

function loadModule(path: string): Record<string, unknown> {
  try {
    return require(path) as Record<string, unknown>;
  } catch {
    return {};
  }
}

describe('catalog about information', () => {
  it('shows demo mode without claiming live TMDB data', () => {
    const mod = loadModule('../catalog-about');
    const getCatalogAboutInfo = mod.getCatalogAboutInfo as undefined | ((mode: 'installed' | 'demo' | 'remote') => unknown);
    expect(getCatalogAboutInfo).toBeDefined();
    expect(getCatalogAboutInfo?.('demo')).toEqual(expect.objectContaining({
      modeLabel: 'Demo catalog',
      usesTmdb: false,
    }));
  });

  it('labels user-installed catalog mode without TMDB attribution', () => {
    const mod = loadModule('../catalog-about');
    const getCatalogAboutInfo = mod.getCatalogAboutInfo as undefined | ((mode: 'installed' | 'demo' | 'remote') => any);
    expect(getCatalogAboutInfo).toBeDefined();
    expect(getCatalogAboutInfo?.('installed')).toEqual({
      modeLabel: 'User-installed catalogs',
      usesTmdb: false,
    });
  });

  it('provides the required TMDB notice for remote catalog mode', () => {
    const mod = loadModule('../catalog-about');
    const getCatalogAboutInfo = mod.getCatalogAboutInfo as undefined | ((mode: 'installed' | 'demo' | 'remote') => any);
    expect(getCatalogAboutInfo).toBeDefined();
    expect(getCatalogAboutInfo?.('remote')).toEqual({
      modeLabel: 'TMDB catalog',
      usesTmdb: true,
      attribution: 'This product uses the TMDB API but is not endorsed or certified by TMDB.',
    });
  });
});

import type {
  CatalogGateway,
  CatalogPage,
  CatalogRequestOptions,
  CatalogSection,
  MediaDetails,
  SeriesSeason,
} from '@moviestv/catalog';

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function usableSection(value: unknown): boolean {
  const section = recordOf(value);
  if (!section) return false;
  const id = typeof section.id === 'string'
    ? section.id.trim()
    : '';
  const title = typeof section.title === 'string'
    ? section.title.trim()
    : '';
  return Boolean(
    id
    && title
    && Array.isArray(section.kinds)
    && section.kinds.some(
      (kind) => kind === 'movie' || kind === 'series',
    ),
  );
}

function usableSections(
  value: unknown,
): value is CatalogSection[] {
  return Array.isArray(value)
    && value.some(usableSection);
}

function usableCatalogItemRoot(value: unknown): boolean {
  const item = recordOf(value);
  if (!item) return false;
  return Boolean(
    typeof item.id === 'string'
    && item.id.trim()
    && (item.kind === 'movie' || item.kind === 'series')
    && typeof item.title === 'string'
    && item.title.trim()
    && typeof item.providerId === 'string'
    && item.providerId.trim()
  );
}

function usablePage(
  value: unknown,
): value is CatalogPage {
  const page = recordOf(value);
  if (!page || !Array.isArray(page.items)) return false;
  return page.items.length === 0
    || page.items.some(usableCatalogItemRoot);
}

function usableDetails(
  value: unknown,
): value is MediaDetails {
  return usableCatalogItemRoot(value);
}

function usableSeason(
  value: unknown,
  expectedSeriesId: string,
  expectedSeasonNumber: number,
): value is SeriesSeason {
  const season = recordOf(value);
  return Boolean(
    season
    && season.seriesId === expectedSeriesId
    && season.seasonNumber === expectedSeasonNumber
    && Array.isArray(season.episodes)
  );
}

function requestedBudgetMs(
  options: CatalogRequestOptions,
): number | null {
  const value = options.timeoutMs;
  return typeof value === 'number'
    && Number.isFinite(value)
    && value > 0
    ? Math.max(1, Math.trunc(value))
    : null;
}

function remainingOptions(
  deadline: number | null,
  options: CatalogRequestOptions,
): CatalogRequestOptions {
  if (deadline === null) return options;
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    throw new Error('Catalog request timed out');
  }
  return {
    ...options,
    timeoutMs: remainingMs,
  };
}

export class FallbackCatalogGateway implements CatalogGateway {
  readonly id: string;
  private readonly fallbackSectionIds = new Set<string>();
  private sectionGeneration = 0;

  constructor(
    private readonly primary: CatalogGateway,
    private readonly fallback: CatalogGateway,
    private readonly primaryTimeoutMs = 3_000,
  ) {
    if (
      !Number.isFinite(primaryTimeoutMs)
      || primaryTimeoutMs <= 0
      || primaryTimeoutMs >= 8_000
    ) {
      throw new TypeError(
        'Invalid catalog primary failover timeout',
      );
    }
    this.id = primary.id;
  }

  private async fromPrimary<T>(
    operation: () => Promise<T>,
    timeoutMs = this.primaryTimeoutMs,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error('Primary catalog failover timeout'));
      }, timeoutMs);
    });

    try {
      return await Promise.race([
        operation(),
        timeout,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async getSections(
    options: CatalogRequestOptions = {},
  ): Promise<CatalogSection[]> {
    const generation = ++this.sectionGeneration;
    this.fallbackSectionIds.clear();
    const budgetMs = requestedBudgetMs(options);
    const deadline = budgetMs === null ? null : Date.now() + budgetMs;
    const primaryBudgetMs = Math.min(
      this.primaryTimeoutMs,
      budgetMs ?? this.primaryTimeoutMs,
    );

    try {
      const sections = await this.fromPrimary(
        () => this.primary.getSections({ timeoutMs: primaryBudgetMs }),
        primaryBudgetMs,
      );
      if (usableSections(sections)) {
        if (generation === this.sectionGeneration) {
          this.fallbackSectionIds.clear();
        }
        return sections;
      }
    } catch {
      // Fall through to the built-in public catalog.
    }

    const sections = await this.fallback.getSections(
      remainingOptions(deadline, options),
    );
    if (generation === this.sectionGeneration) {
      this.fallbackSectionIds.clear();
      for (const section of sections) {
        if (usableSection(section)) {
          this.fallbackSectionIds.add(section.id.trim());
        }
      }
    }
    return sections;
  }

  async browse(
    sectionId: string,
    cursor?: string,
    options: CatalogRequestOptions = {},
  ): Promise<CatalogPage> {
    const budgetMs = requestedBudgetMs(options);
    const deadline = budgetMs === null ? null : Date.now() + budgetMs;
    if (this.fallbackSectionIds.has(sectionId.trim())) {
      return this.fallback.browse(
        sectionId,
        cursor,
        remainingOptions(deadline, options),
      );
    }
    const primaryBudgetMs = Math.min(
      this.primaryTimeoutMs,
      budgetMs ?? this.primaryTimeoutMs,
    );

    try {
      const page = await this.fromPrimary(
        () => this.primary.browse(
          sectionId,
          cursor,
          { timeoutMs: primaryBudgetMs },
        ),
        primaryBudgetMs,
      );
      if (usablePage(page)) return page;
    } catch {
      // Try the fallback for the same section below.
    }

    return this.fallback.browse(
      sectionId,
      cursor,
      remainingOptions(deadline, options),
    );
  }

  async search(
    query: string,
    cursor?: string,
    options: CatalogRequestOptions = {},
  ): Promise<CatalogPage> {
    const budgetMs = requestedBudgetMs(options);
    const deadline = budgetMs === null ? null : Date.now() + budgetMs;
    const primaryBudgetMs = Math.min(
      this.primaryTimeoutMs,
      budgetMs ?? this.primaryTimeoutMs,
    );
    try {
      const page = await this.fromPrimary(
        () => this.primary.search(
          query,
          cursor,
          { timeoutMs: primaryBudgetMs },
        ),
        primaryBudgetMs,
      );
      if (usablePage(page)) return page;
    } catch {
      // Try the fallback search below.
    }

    return this.fallback.search(
      query,
      cursor,
      remainingOptions(deadline, options),
    );
  }

  async getDetails(
    mediaId: string,
    options: CatalogRequestOptions = {},
  ): Promise<MediaDetails | null> {
    const budgetMs = requestedBudgetMs(options);
    const deadline = budgetMs === null ? null : Date.now() + budgetMs;
    const primaryBudgetMs = Math.min(
      this.primaryTimeoutMs,
      budgetMs ?? this.primaryTimeoutMs,
    );
    try {
      const details = await this.fromPrimary(
        () => this.primary.getDetails(
          mediaId,
          { timeoutMs: primaryBudgetMs },
        ),
        primaryBudgetMs,
      );
      if (usableDetails(details)) return details;
    } catch {
      // A fallback catalog may still understand this media identity.
    }

    return this.fallback.getDetails(
      mediaId,
      remainingOptions(deadline, options),
    );
  }

  async getSeason(
    seriesId: string,
    seasonNumber: number,
    options: CatalogRequestOptions = {},
  ): Promise<SeriesSeason | null> {
    const budgetMs = requestedBudgetMs(options);
    const deadline = budgetMs === null ? null : Date.now() + budgetMs;
    const primaryBudgetMs = Math.min(
      this.primaryTimeoutMs,
      budgetMs ?? this.primaryTimeoutMs,
    );
    try {
      const season = await this.fromPrimary(
        () => this.primary.getSeason(
          seriesId,
          seasonNumber,
          { timeoutMs: primaryBudgetMs },
        ),
        primaryBudgetMs,
      );
      if (usableSeason(season, seriesId, seasonNumber)) {
        return season;
      }
    } catch {
      // A fallback catalog may still understand this series identity.
    }

    return this.fallback.getSeason(
      seriesId,
      seasonNumber,
      remainingOptions(deadline, options),
    );
  }
}

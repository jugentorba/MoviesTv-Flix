import type { CatalogGateway, CatalogPage, CatalogSection, MediaDetails, SeriesSeason } from '@moviestv/catalog';
import { demoDetails, demoItems, demoItemsForSection, demoSeasons, demoSections } from './demo-data';

export class DemoCatalogGateway implements CatalogGateway {
  readonly id = 'demo';

  async getSections(): Promise<CatalogSection[]> {
    return demoSections;
  }

  async browse(sectionId: string): Promise<CatalogPage> {
    return { items: demoItemsForSection(sectionId) };
  }

  async search(query: string): Promise<CatalogPage> {
    const normalized = query.trim().toLocaleLowerCase();
    if (normalized.length < 2) return { items: [] };
    return {
      items: demoItems.filter((item) =>
        item.title.toLocaleLowerCase().includes(normalized)
        || item.overview?.toLocaleLowerCase().includes(normalized),
      ),
    };
  }

  async getDetails(mediaId: string): Promise<MediaDetails | null> {
    return demoDetails.find((item) => item.id === mediaId) ?? null;
  }

  async getSeason(seriesId: string, seasonNumber: number): Promise<SeriesSeason | null> {
    return demoSeasons.find(
      (season) => season.seriesId === seriesId && season.seasonNumber === seasonNumber,
    ) ?? null;
  }
}

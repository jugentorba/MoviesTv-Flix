import type { GuideSnapshot } from '@moviestv/live-tv';
import type {
  GuideConfigState,
  LiveTvGuideRepository,
} from './LiveTvGuideRepository';
import type { XmlTvGuideProvider } from './XmlTvGuideProvider';

interface GuideProviderLike {
  load(url: string, sourceRevision: number): Promise<GuideSnapshot>;
}

interface GuideRepositoryLike {
  saveValidatedUrl(rawUrl: string): Promise<GuideConfigState>;
  saveCache(snapshot: GuideSnapshot): Promise<void>;
}

export async function validateAndSaveLiveTvGuide(
  rawUrl: string,
  provider: GuideProviderLike,
  repository: GuideRepositoryLike,
): Promise<GuideConfigState> {
  const validated = await provider.load(rawUrl, 1);
  const config = await repository.saveValidatedUrl(rawUrl);
  await repository.saveCache({
    ...validated,
    sourceRevision: config.sourceRevision,
  });
  return config;
}

export type { LiveTvGuideRepository, XmlTvGuideProvider };

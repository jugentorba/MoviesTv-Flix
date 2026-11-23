import type { GuideSnapshot } from '@moviestv/live-tv';
import { validateAndSaveLiveTvGuide } from '../live-tv-guide-setup';

const snapshot: GuideSnapshot = {
  sourceRevision: 1,
  fetchedAtMs: 1_000,
  channels: [{
    id: 'fr2',
    displayNames: ['France 2'],
    countryCode: 'FR',
  }],
  programmes: [{
    channelId: 'fr2',
    title: 'Journal',
    startAtMs: 900,
    endAtMs: 1_800,
  }],
};

describe('validateAndSaveLiveTvGuide', () => {
  it('validates XMLTV before saving configuration and cache', async () => {
    const provider = {
      load: jest.fn().mockResolvedValue(snapshot),
    };
    const repository = {
      saveValidatedUrl: jest.fn().mockResolvedValue({
        configured: true,
        sourceRevision: 4,
        secure: true,
      }),
      saveCache: jest.fn().mockResolvedValue(undefined),
    };

    const result = await validateAndSaveLiveTvGuide(
      'https://guide.example/epg.xml?token=secret',
      provider,
      repository,
    );

    expect(provider.load).toHaveBeenCalledWith(
      'https://guide.example/epg.xml?token=secret',
      1,
    );
    expect(repository.saveValidatedUrl).toHaveBeenCalledWith(
      'https://guide.example/epg.xml?token=secret',
    );
    expect(repository.saveCache).toHaveBeenCalledWith({
      ...snapshot,
      sourceRevision: 4,
    });
    expect(result.sourceRevision).toBe(4);
  });

  it('does not persist a source that fails XMLTV validation', async () => {
    const provider = {
      load: jest.fn().mockRejectedValue(new Error('Malformed XMLTV')),
    };
    const repository = {
      saveValidatedUrl: jest.fn(),
      saveCache: jest.fn(),
    };

    await expect(
      validateAndSaveLiveTvGuide(
        'https://guide.example/bad.xml',
        provider,
        repository,
      ),
    ).rejects.toThrow('Malformed XMLTV');

    expect(repository.saveValidatedUrl).not.toHaveBeenCalled();
    expect(repository.saveCache).not.toHaveBeenCalled();
  });
});

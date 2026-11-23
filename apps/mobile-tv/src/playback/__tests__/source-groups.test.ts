import {
  formatBytes,
  groupSources,
  providerOptions,
  providerLabel,
  qualityLabel,
  resolutionBucket,
  sourceTag,
} from '../sourceGroups';

const source = (overrides: object) => ({
  id: 's',
  url: 'https://cdn.example/x.mkv',
  ...overrides,
});

describe('resolutionBucket', () => {
  test('reads the quality field even when providers spell it differently', () => {
    expect(resolutionBucket(source({ quality: '2160p' }))).toBe('4k');
    expect(resolutionBucket(source({ quality: '4K' }))).toBe('4k');
    expect(resolutionBucket(source({ quality: 'UHD' }))).toBe('4k');
    expect(resolutionBucket(source({ quality: 'FHD' }))).toBe('1080');
    expect(resolutionBucket(source({ quality: '720p' }))).toBe('720');
  });

  test('falls back to the filename, then the codec detail', () => {
    expect(resolutionBucket(source({ filename: 'Movie.2024.2160p.WEB-DL.mkv' }))).toBe('4k');
    expect(resolutionBucket(source({ codecDetail: '1920x1080' }))).toBe('1080');
  });

  test('unknown stays unknown instead of guessing', () => {
    expect(resolutionBucket(source({ quality: 'Good' }))).toBe('unknown');
    expect(qualityLabel('unknown')).toBe('Other');
  });
});

describe('sourceTag', () => {
  test('recognises the release tags the chips and cards show', () => {
    expect(sourceTag(source({ name: 'Movie 1080p BluRay x264' }))).toBe('BluRay');
    expect(sourceTag(source({ name: 'Movie.2024.1080p.WEB-DL.DDP5.1' }))).toBe('WEB-DL');
    expect(sourceTag(source({ filename: 'Movie.2160p.REMUX.HDR.mkv' }))).toBe('Remux');
    expect(sourceTag(source({ name: 'Movie CAM' }))).toBe('CAM');
  });

  test('no tag is better than a wrong tag', () => {
    expect(sourceTag(source({ name: 'Movie' }))).toBeUndefined();
  });
});

describe('providerLabel', () => {
  test('turns a reverse-domain id into the name a chip can show', () => {
    expect(providerLabel('com.stremio.torrentio.addon')).toBe('Torrentio');
    expect(providerLabel('org.example.alpha')).toBe('Alpha');
    expect(providerLabel('lumio')).toBe('Lumio');
  });
});

describe('providerOptions', () => {
  test('counts sources per provider, busiest first', () => {
    const options = providerOptions([
      source({ id: '1', providerId: 'com.stremio.torrentio.addon' }),
      source({ id: '2', providerId: 'com.stremio.torrentio.addon' }),
      source({ id: '3', providerId: 'lumio' }),
    ]);

    expect(options).toEqual([
      { id: 'com.stremio.torrentio.addon', label: 'Torrentio', count: 2 },
      { id: 'lumio', label: 'Lumio', count: 1 },
    ]);
  });
});

describe('groupSources', () => {
  test('groups by quality and keeps the size of the best source', () => {
    const groups = groupSources([
      source({ id: 'a', quality: '1080p', name: 'A BluRay', sizeBytes: 489 * 1024 * 1024 }),
      source({ id: 'b', quality: '1080p', name: 'B WEB-DL', sizeBytes: 900 * 1024 * 1024 }),
      source({ id: 'c', quality: '720p', name: 'C WEB-DL' }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].label).toBe('1080p');
    expect(groups[0].count).toBe(2);
    expect(groups[0].sizeBytes).toBe(489 * 1024 * 1024);
    expect(groups[0].sources.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(formatBytes(groups[0].sizeBytes)).toBe('489 MB');
  });

  test('orders groups by the best-ranked source, not by resolution', () => {
    // A 720p source ranked above a 2160p one must not be pushed to the bottom:
    // the resolver already decided, and grouping must not overrule it.
    const groups = groupSources([
      source({ id: 'first', quality: '720p' }),
      source({ id: 'second', quality: '2160p' }),
    ]);

    expect(groups.map((group) => group.label)).toEqual(['720p', '2160p']);
  });

  test('reports the dominant release tag per group', () => {
    const [group] = groupSources([
      source({ id: 'a', quality: '1080p', name: 'A BluRay' }),
      source({ id: 'b', quality: '1080p', name: 'B BluRay' }),
      source({ id: 'c', quality: '1080p', name: 'C WEB-DL' }),
    ]);

    expect(group.tag).toBe('BluRay');
  });

  test('a group with no declared size omits the badge rather than showing 0 MB', () => {
    const [group] = groupSources([source({ quality: '480p' })]);
    expect(group.sizeBytes).toBeUndefined();
    expect(formatBytes(group.sizeBytes)).toBeUndefined();
  });
});

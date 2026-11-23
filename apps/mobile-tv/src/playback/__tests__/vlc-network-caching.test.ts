import { BUFFER_MODES, vlcCachingMs, nextBufferMode, isBufferMode } from '../bufferMode';

describe('buffer modes', () => {
  it('maps each mode to a plausible VLC network cache', () => {
    // 3000 was the old hard-coded value and made 4K sources start slowly.
    expect(vlcCachingMs('fast')).toBeLessThan(vlcCachingMs('balanced'));
    expect(vlcCachingMs('balanced')).toBeLessThan(vlcCachingMs('stable'));
    expect(vlcCachingMs('balanced')).toBeLessThanOrEqual(1500);
    expect(vlcCachingMs('stable')).toBeGreaterThanOrEqual(2000);
  });

  it('cycles through the three modes', () => {
    expect(nextBufferMode('fast')).toBe('balanced');
    expect(nextBufferMode('balanced')).toBe('stable');
    expect(nextBufferMode('stable')).toBe('fast');
  });

  it('rejects unknown stored values so a bad write cannot break playback', () => {
    expect(isBufferMode('turbo')).toBe(false);
    expect(isBufferMode(undefined)).toBe(false);
    for (const mode of BUFFER_MODES) expect(isBufferMode(mode)).toBe(true);
  });
});

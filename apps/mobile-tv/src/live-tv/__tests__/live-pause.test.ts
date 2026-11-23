import { livePauseMode, liveSeekTarget } from '../livePause';

describe('livePauseMode', () => {
  it('offers pause when the stream exposes a finite window', () => {
    expect(livePauseMode(3600)).toBe('pausable');
    expect(livePauseMode(0.5)).toBe('pausable');
  });

  it('refuses when the stream is a plain live edge', () => {
    // Live HLS reports Infinity; pausing there would jump back to live.
    expect(livePauseMode(Number.POSITIVE_INFINITY)).toBe('unavailable');
    expect(livePauseMode(Number.NaN)).toBe('unavailable');
  });

  it('refuses when nothing is known yet', () => {
    expect(livePauseMode(undefined)).toBe('unavailable');
    expect(livePauseMode(null)).toBe('unavailable');
  });

  it('refuses a zero-length stream', () => {
    expect(livePauseMode(0)).toBe('unavailable');
    expect(livePauseMode(-5)).toBe('unavailable');
  });
});

describe('liveSeekTarget', () => {
  it('clamps a seek into the window', () => {
    expect(liveSeekTarget(120, 3600)).toBe(120);
    expect(liveSeekTarget(-10, 3600)).toBe(0);
    expect(liveSeekTarget(9999, 3600)).toBe(3600);
  });

  it('returns null when the channel cannot seek', () => {
    expect(liveSeekTarget(120, Number.POSITIVE_INFINITY)).toBeNull();
    expect(liveSeekTarget(120, undefined)).toBeNull();
    expect(liveSeekTarget(Number.NaN, 3600)).toBeNull();
  });
});

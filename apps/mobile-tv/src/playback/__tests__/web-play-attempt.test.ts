import {
  classifyWebPlayFailure,
  shouldAttemptWebPlayback,
  shouldDeferWebPlayFailure,
  shouldRevealWebPlayButton,
} from '../webPlayAttempt';

describe('classifyWebPlayFailure', () => {
  it('classifies common browser play rejections', () => {
    expect(classifyWebPlayFailure({ name: 'NotAllowedError' })).toBe('interaction-required');
    expect(classifyWebPlayFailure({ name: 'NotSupportedError' })).toBe('source-failed');
    expect(classifyWebPlayFailure({ name: 'AbortError' })).toBe('interrupted');
    expect(classifyWebPlayFailure(new Error('other'))).toBe('unknown');
    expect(classifyWebPlayFailure(null)).toBe('unknown');
  });
});


describe('shouldDeferWebPlayFailure', () => {
  it('defers an early HLS NotSupportedError until media becomes playable', () => {
    expect(shouldDeferWebPlayFailure('source-failed', true, 0)).toBe(true);
    expect(shouldDeferWebPlayFailure('source-failed', true, 2)).toBe(true);
    expect(shouldDeferWebPlayFailure('source-failed', true, 3)).toBe(false);
  });

  it('defers only pre-metadata direct-source failures', () => {
    expect(shouldDeferWebPlayFailure('source-failed', false, 0)).toBe(true);
    expect(shouldDeferWebPlayFailure('source-failed', false, 1)).toBe(false);
    expect(shouldDeferWebPlayFailure('source-failed', false, 2)).toBe(false);
  });

  it('does not defer non-source failures', () => {
    expect(shouldDeferWebPlayFailure('interaction-required', true, 0)).toBe(false);
    expect(shouldDeferWebPlayFailure('interrupted', true, 0)).toBe(false);
    expect(shouldDeferWebPlayFailure('unknown', false, 0)).toBe(false);
  });
});


describe('shouldRevealWebPlayButton', () => {
  it('always reveals a user-gesture fallback for autoplay denial', () => {
    expect(shouldRevealWebPlayButton('interaction-required')).toBe(true);
    expect(shouldRevealWebPlayButton('interaction-required', false)).toBe(true);
  });

  it('reveals unknown failures only for an explicit retry path', () => {
    expect(shouldRevealWebPlayButton('unknown')).toBe(false);
    expect(shouldRevealWebPlayButton('unknown', true)).toBe(true);
    expect(shouldRevealWebPlayButton('interrupted', true)).toBe(false);
    expect(shouldRevealWebPlayButton('source-failed', true)).toBe(false);
  });
});


describe('shouldAttemptWebPlayback', () => {
  it('defers playback while the page is hidden or browser is offline', () => {
    expect(shouldAttemptWebPlayback('hidden', true)).toBe(false);
    expect(shouldAttemptWebPlayback('visible', false)).toBe(false);
    expect(shouldAttemptWebPlayback('hidden', false)).toBe(false);
  });

  it('allows playback for visible or initially unknown page state', () => {
    expect(shouldAttemptWebPlayback('visible', true)).toBe(true);
    expect(shouldAttemptWebPlayback(undefined, true)).toBe(true);
    expect(shouldAttemptWebPlayback('visible', undefined)).toBe(true);
  });
});

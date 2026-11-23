import {
  nextPlaybackRate,
  toggleVideoFitMode,
} from '../playerControlState';

test('cycles through modern playback speed presets', () => {
  expect(nextPlaybackRate(1)).toBe(1.25);
  expect(nextPlaybackRate(1.25)).toBe(1.5);
  expect(nextPlaybackRate(1.5)).toBe(2);
  expect(nextPlaybackRate(2)).toBe(1);
  expect(nextPlaybackRate(9)).toBe(1);
});

test('toggles between whole-video fit and full-screen crop', () => {
  expect(toggleVideoFitMode('contain')).toBe('cover');
  expect(toggleVideoFitMode('cover')).toBe('contain');
});

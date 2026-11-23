import { playbackBackAction } from '../playbackBackAction';

test('movie playback Back closes the innermost open layer first', () => {
  expect(playbackBackAction({
    audioChooserOpen: true,
    subtitleChooserOpen: true,
    sourceChooserOpen: true,
    playbackOpen: true,
  })).toBe('audio');

  expect(playbackBackAction({
    audioChooserOpen: false,
    subtitleChooserOpen: true,
    sourceChooserOpen: true,
    playbackOpen: true,
  })).toBe('subtitles');

  expect(playbackBackAction({
    audioChooserOpen: false,
    subtitleChooserOpen: false,
    sourceChooserOpen: true,
    playbackOpen: true,
  })).toBe('sources');

  expect(playbackBackAction({
    audioChooserOpen: false,
    subtitleChooserOpen: false,
    sourceChooserOpen: false,
    playbackOpen: true,
  })).toBe('playback');
});

test('movie playback Back falls through when playback is closed', () => {
  expect(playbackBackAction({
    audioChooserOpen: false,
    subtitleChooserOpen: false,
    sourceChooserOpen: false,
    playbackOpen: false,
  })).toBeNull();
});

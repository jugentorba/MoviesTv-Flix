import {
  pauseWebMediaForBackground,
  shouldResumeWebMediaAfterBackground,
} from '../webBackgroundMedia';

test('pauses an active web media element and remembers that it should resume', () => {
  const media = {
    paused: false,
    ended: false,
    pause: jest.fn(),
  };

  expect(pauseWebMediaForBackground(media)).toBe(true);
  expect(media.pause).toHaveBeenCalledTimes(1);
});

test('does not request resume for media that was already paused or ended', () => {
  const paused = {
    paused: true,
    ended: false,
    pause: jest.fn(),
  };
  const ended = {
    paused: false,
    ended: true,
    pause: jest.fn(),
  };

  expect(pauseWebMediaForBackground(paused)).toBe(false);
  expect(pauseWebMediaForBackground(ended)).toBe(false);
  expect(paused.pause).not.toHaveBeenCalled();
  expect(ended.pause).not.toHaveBeenCalled();
});


test('resumes web media only when the page is visible and online', () => {
  expect(shouldResumeWebMediaAfterBackground({
    resumeRequested: true,
    visibilityState: 'visible',
    online: true,
    ended: false,
  })).toBe(true);

  expect(shouldResumeWebMediaAfterBackground({
    resumeRequested: true,
    visibilityState: 'hidden',
    online: true,
    ended: false,
  })).toBe(false);

  expect(shouldResumeWebMediaAfterBackground({
    resumeRequested: true,
    visibilityState: 'visible',
    online: false,
    ended: false,
  })).toBe(false);

  expect(shouldResumeWebMediaAfterBackground({
    resumeRequested: true,
    visibilityState: 'visible',
    online: true,
    ended: true,
  })).toBe(false);
});

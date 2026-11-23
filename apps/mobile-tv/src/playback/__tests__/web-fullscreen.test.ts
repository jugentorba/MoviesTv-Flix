import { toggleWebVideoFullscreen } from '../webFullscreen';

test('uses the standard container fullscreen API when available', async () => {
  const requestFullscreen = jest.fn(async () => undefined);
  const exitFullscreen = jest.fn(async () => undefined);
  const webkitEnterFullscreen = jest.fn();

  await toggleWebVideoFullscreen(
    {
      parentElement: { requestFullscreen },
      webkitEnterFullscreen,
    },
    {
      fullscreenElement: null,
      exitFullscreen,
    },
  );

  expect(requestFullscreen).toHaveBeenCalledTimes(1);
  expect(webkitEnterFullscreen).not.toHaveBeenCalled();
  expect(exitFullscreen).not.toHaveBeenCalled();
});

test('exits an active standard fullscreen session', async () => {
  const requestFullscreen = jest.fn(async () => undefined);
  const exitFullscreen = jest.fn(async () => undefined);
  const webkitEnterFullscreen = jest.fn();

  await toggleWebVideoFullscreen(
    {
      parentElement: { requestFullscreen },
      webkitEnterFullscreen,
    },
    {
      fullscreenElement: {},
      exitFullscreen,
    },
  );

  expect(exitFullscreen).toHaveBeenCalledTimes(1);
  expect(requestFullscreen).not.toHaveBeenCalled();
  expect(webkitEnterFullscreen).not.toHaveBeenCalled();
});

test('falls back to iPhone video fullscreen when standard fullscreen rejects', async () => {
  const requestFullscreen = jest.fn(async () => {
    throw new Error('blocked');
  });
  const webkitEnterFullscreen = jest.fn();

  await toggleWebVideoFullscreen(
    {
      parentElement: { requestFullscreen },
      webkitEnterFullscreen,
    },
    {},
  );

  expect(requestFullscreen).toHaveBeenCalledTimes(1);
  expect(webkitEnterFullscreen).toHaveBeenCalledTimes(1);
});

test('keeps inline playback usable when iPhone native fullscreen throws', async () => {
  const webkitEnterFullscreen = jest.fn(() => {
    throw new Error('fullscreen blocked');
  });

  await expect(toggleWebVideoFullscreen(
    { webkitEnterFullscreen },
    {},
  )).resolves.toBeUndefined();

  expect(webkitEnterFullscreen).toHaveBeenCalledTimes(1);
});

test('falls back to iPhone video fullscreen when the standard API is missing', async () => {
  const webkitEnterFullscreen = jest.fn();

  await toggleWebVideoFullscreen(
    {
      parentElement: {},
      webkitEnterFullscreen,
    },
    {},
  );

  expect(webkitEnterFullscreen).toHaveBeenCalledTimes(1);
});

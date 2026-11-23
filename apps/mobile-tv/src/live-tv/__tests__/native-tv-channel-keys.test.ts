import { nativeTvChannelAction } from '../useNativeTvChannelKeys.native';

test('native TV channel keys zap once on key-up events', () => {
  expect(nativeTvChannelAction({
    eventType: 'channelUp',
    eventKeyAction: 1,
  } as any)).toBe('next');
  expect(nativeTvChannelAction({
    eventType: 'channelDown',
    eventKeyAction: 1,
  } as any)).toBe('previous');

  expect(nativeTvChannelAction({
    eventType: 'channelUp',
    eventKeyAction: 0,
  } as any)).toBeNull();
  expect(nativeTvChannelAction({
    eventType: 'channelDown',
    eventKeyAction: 0,
  } as any)).toBeNull();
});

test('native TV channel mapping ignores unrelated remote events', () => {
  expect(nativeTvChannelAction({
    eventType: 'select',
    eventKeyAction: 1,
  } as any)).toBeNull();
  expect(nativeTvChannelAction({
    eventType: 'playPause',
    eventKeyAction: 1,
  } as any)).toBeNull();
});

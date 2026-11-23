import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { PlayerChrome, type PlayerAction } from '../PlayerChrome';

const insets = { top: 62, right: 62, bottom: 20, left: 0 };

const actions: PlayerAction[] = [
  { key: 'audio', icon: 'musical-notes', label: 'Audio', testID: 'act-audio', onPress: jest.fn() },
  { key: 'speed', icon: 'speedometer', label: 'Speed', value: '1.5×', testID: 'act-speed' },
  { key: 'fit', icon: 'expand', label: 'Fit', value: 'Fill', active: true, testID: 'act-fit' },
];

function renderChrome(overrides: Partial<React.ComponentProps<typeof PlayerChrome>> = {}) {
  return render(
    <PlayerChrome
      title="Modern Family"
      meta="S3 E17 • J'ai 10 ans !"
      submeta="2160p · HEVC · com.stremio.torrentio.addon"
      position={741}
      duration={1314}
      actions={actions}
      insets={insets}
      onSeekRatio={jest.fn()}
      {...overrides}
    />,
  );
}

test('shows the title block the player reads bottom-left', () => {
  renderChrome();
  expect(screen.getByText('Modern Family')).toBeTruthy();
  expect(screen.getByText("S3 E17 • J'ai 10 ans !")).toBeTruthy();
  expect(screen.getByText('2160p · HEVC · com.stremio.torrentio.addon')).toBeTruthy();
});

test('shows elapsed and total time at the end of the icon row', () => {
  renderChrome();
  expect(screen.getByTestId('player-chrome-time').props.children.join('')).toBe('12:21 / 21:54');
});

test('draws state on the icon instead of a caption', () => {
  renderChrome();
  // Actions are icons; only state values are written next to them.
  expect(screen.getByText('1.5×')).toBeTruthy();
  expect(screen.getByText('Fill')).toBeTruthy();
  expect(screen.queryByText('Audio')).toBeNull();
  expect(screen.getByTestId('act-audio').props.accessibilityLabel).toBe('Audio');
});

test('marks an active action as selected', () => {
  renderChrome();
  expect(screen.getByTestId('act-fit').props.accessibilityState).toEqual({ selected: true });
  expect(screen.getByTestId('act-audio').props.accessibilityState?.selected).toBeUndefined();
});

test('a tap on the scrubber reports the ratio, not pixels', () => {
  const onSeekRatio = jest.fn();
  renderChrome({ onSeekRatio });

  const track = screen.getByTestId('player-chrome-progress');
  fireEvent(track, 'layout', { nativeEvent: { layout: { width: 200 } } });
  fireEvent.press(track, { nativeEvent: { locationX: 50 } });

  expect(onSeekRatio).toHaveBeenCalledWith(0.25);
});

test('locked hides every control and leaves one unlock target', () => {
  const onToggleLock = jest.fn();
  renderChrome({ locked: true, onToggleLock });

  expect(screen.queryByText('Modern Family')).toBeNull();
  expect(screen.queryByTestId('act-audio')).toBeNull();

  fireEvent.press(screen.getByTestId('player-chrome-unlock'));
  expect(onToggleLock).toHaveBeenCalledTimes(1);
});

test('presses reach the action that owns them', () => {
  renderChrome();
  fireEvent.press(screen.getByTestId('act-audio'));
  expect(actions[0].onPress).toHaveBeenCalledTimes(1);
});

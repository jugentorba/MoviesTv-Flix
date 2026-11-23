import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { IconBackButton } from '../IconBackButton';
import {
  SWIPE_BACK_DISTANCE,
  SWIPE_BACK_EDGE,
  shouldCaptureSwipe,
  shouldCompleteSwipe,
} from '../useSwipeBack';
import { ThemeProvider } from '../../theme/ThemeProvider';

function renderBack(onPress: jest.Mock = jest.fn()) {
  render(
    <ThemeProvider>
      <IconBackButton label="Back" onPress={onPress} testID="sample-back" />
    </ThemeProvider>,
  );
  return onPress;
}

test('the back control is an icon-only button with an accessible name', () => {
  const onPress = renderBack();
  const button = screen.getByTestId('sample-back');

  expect(button.props.accessibilityLabel).toBe('Back');
  fireEvent.press(button);
  expect(onPress).toHaveBeenCalledTimes(1);
});

test('a swipe only becomes back navigation when it starts at the edge', () => {
  // From the edge, horizontal: captures.
  expect(shouldCaptureSwipe(4, 30, 6)).toBe(true);
  // From the middle of the screen a carousel must keep its gesture.
  expect(shouldCaptureSwipe(200, 60, 4)).toBe(false);
  // Vertical travel means a scroll, not a back swipe.
  expect(shouldCaptureSwipe(4, 30, 90)).toBe(false);
  // A tiny twitch is not a gesture.
  expect(shouldCaptureSwipe(4, 4, 1)).toBe(false);
});

test('the edge band is small enough to leave the screen usable', () => {
  expect(SWIPE_BACK_EDGE).toBeLessThanOrEqual(40);
});

test('a short drag cancels, a long one goes back', () => {
  expect(shouldCompleteSwipe(SWIPE_BACK_DISTANCE - 10)).toBe(false);
  expect(shouldCompleteSwipe(SWIPE_BACK_DISTANCE)).toBe(true);
});

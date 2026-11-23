import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AppErrorBoundary } from '../AppErrorBoundary';

function Boom({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('render failed');
  return <Text>recovered content</Text>;
}

// React logs the caught error; keep the test output readable.
const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
afterAll(() => consoleError.mockRestore());

test('a render error shows a recovery screen instead of a blank window', () => {
  render(
    <AppErrorBoundary>
      <Boom shouldThrow />
    </AppErrorBoundary>,
  );

  expect(screen.getByTestId('app-error-boundary')).toBeTruthy();
  expect(screen.getByText('This screen could not be drawn')).toBeTruthy();
  expect(screen.getByTestId('app-error-retry')).toBeTruthy();
});

test('a healthy tree renders untouched', () => {
  render(
    <AppErrorBoundary>
      <Boom shouldThrow={false} />
    </AppErrorBoundary>,
  );

  expect(screen.getByText('recovered content')).toBeTruthy();
  expect(screen.queryByTestId('app-error-boundary')).toBeNull();
});

test('retry clears the error and asks the host to remount', () => {
  const onReset = jest.fn();
  const view = render(
    <AppErrorBoundary onReset={onReset}>
      <Boom shouldThrow />
    </AppErrorBoundary>,
  );

  view.rerender(
    <AppErrorBoundary onReset={onReset}>
      <Boom shouldThrow={false} />
    </AppErrorBoundary>,
  );

  fireEvent.press(screen.getByTestId('app-error-retry'));

  expect(onReset).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('app-error-boundary')).toBeNull();
});

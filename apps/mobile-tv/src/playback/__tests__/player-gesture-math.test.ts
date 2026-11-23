import {
  axisFromTouch,
  isSliderDrag,
  percentLabel,
  toEngineVolume,
  valueFromDrag,
} from '../playerGestureMath';

test('the left half is brightness and the right half is volume', () => {
  expect(axisFromTouch(10, 800)).toBe('brightness');
  expect(axisFromTouch(399, 800)).toBe('brightness');
  expect(axisFromTouch(401, 800)).toBe('volume');
  expect(axisFromTouch(790, 800)).toBe('volume');
});

test('a broken width never produces an axis', () => {
  expect(axisFromTouch(10, 0)).toBeNull();
  expect(axisFromTouch(Number.NaN, 800)).toBeNull();
});

test('dragging up raises the value and down lowers it', () => {
  // Half the screen height is half the range.
  expect(valueFromDrag(0.5, -200, 400)).toBeCloseTo(1);
  expect(valueFromDrag(0.5, 200, 400)).toBeCloseTo(0);
  expect(valueFromDrag(0.5, -100, 400)).toBeCloseTo(0.75);
});

test('values stay inside 0–1 at the edges', () => {
  expect(valueFromDrag(0.05, 1000, 400)).toBe(0);
  expect(valueFromDrag(0.95, -1000, 400)).toBe(1);
});

test('a mostly horizontal movement is not a slider drag', () => {
  expect(isSliderDrag(120, 20)).toBe(false);
  expect(isSliderDrag(10, 40)).toBe(true);
  // A small twitch stays a tap.
  expect(isSliderDrag(2, 6)).toBe(false);
});

test('each engine gets the scale it expects', () => {
  expect(toEngineVolume(0.5, 'expo')).toBe(0.5);
  expect(toEngineVolume(0.5, 'vlc')).toBe(50);
  expect(toEngineVolume(2, 'vlc')).toBe(100);
  expect(toEngineVolume(-1, 'expo')).toBe(0);
});

test('the indicator reads as a percentage', () => {
  expect(percentLabel(0.42)).toBe('42%');
  expect(percentLabel(0)).toBe('0%');
});

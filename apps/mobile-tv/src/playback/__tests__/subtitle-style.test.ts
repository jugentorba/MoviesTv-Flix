import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_SUBTITLE_STYLE,
  normalizeSubtitleStyle,
  readSubtitleStyle,
  subtitleMetrics,
  writeSubtitleStyle,
} from '../subtitleStyle';

beforeEach(async () => {
  await AsyncStorage.clear();
});

test('an unreadable style falls back to the default instead of breaking captions', () => {
  expect(normalizeSubtitleStyle(null)).toEqual(DEFAULT_SUBTITLE_STYLE);
  expect(normalizeSubtitleStyle('large')).toEqual(DEFAULT_SUBTITLE_STYLE);
  expect(normalizeSubtitleStyle({ size: 'huge', background: 'neon' }))
    .toEqual(DEFAULT_SUBTITLE_STYLE);
});

test('a partially valid style keeps what it can', () => {
  expect(normalizeSubtitleStyle({ size: 'large' })).toEqual({
    size: 'large',
    background: DEFAULT_SUBTITLE_STYLE.background,
    offset: 0,
    bold: false,
  });
});

test('each size scales the type and its line height together', () => {
  const small = subtitleMetrics({ size: 'small', background: 'off', offset: 0, bold: false });
  const medium = subtitleMetrics({ size: 'medium', background: 'off', offset: 0, bold: false });
  const large = subtitleMetrics({ size: 'large', background: 'off', offset: 0, bold: false });

  expect(small.fontSize).toBeLessThan(medium.fontSize);
  expect(large.fontSize).toBeGreaterThan(medium.fontSize);
  // Line height must grow with the font, or accents get clipped.
  expect(large.lineHeight / large.fontSize).toBeGreaterThan(1.2);
  expect(small.lineHeight).toBeGreaterThan(small.fontSize);
});

test('the background choice is visible in the metrics', () => {
  expect(subtitleMetrics({ size: 'medium', background: 'off', offset: 0, bold: false }).backgroundColor)
    .toBe('transparent');
  expect(subtitleMetrics({ size: 'medium', background: 'soft', offset: 0, bold: false }).backgroundColor)
    .toBe('rgba(0,0,0,0.42)');
  expect(subtitleMetrics({ size: 'medium', background: 'solid', offset: 0, bold: false }).backgroundColor)
    .toBe('rgba(0,0,0,0.86)');
});

test('the chosen style survives a reload', async () => {
  await writeSubtitleStyle({ size: 'large', background: 'solid', offset: 0, bold: true });
  expect(await readSubtitleStyle()).toEqual({ size: 'large', background: 'solid', offset: 0, bold: true });
});

test('a corrupt stored value reads as the default', async () => {
  await AsyncStorage.setItem('moviestv:subtitle-style:v1', 'not json');
  expect(await readSubtitleStyle()).toEqual(DEFAULT_SUBTITLE_STYLE);
});

test('bold and the vertical offset reach the metrics', () => {
  const bold = subtitleMetrics({ size: 'medium', background: 'soft', offset: 72, bold: true });
  const plain = subtitleMetrics({ size: 'medium', background: 'soft', offset: 0, bold: false });

  expect(bold.fontWeight).toBe('700');
  expect(plain.fontWeight).toBe('400');
});

test('an absurd stored offset is clamped, not trusted', () => {
  expect(normalizeSubtitleStyle({ offset: -9999 }).offset).toBe(-160);
  expect(normalizeSubtitleStyle({ offset: 9999 }).offset).toBe(240);
  expect(normalizeSubtitleStyle({ offset: 'high' }).offset).toBe(0);
});

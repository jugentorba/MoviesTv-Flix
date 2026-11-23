import {
  accentFromHue,
  contrastRatio,
  DEFAULT_ACCENT_HUE,
  hslToHex,
  hueFromHex,
  isAccentHue,
} from '@moviestv/ui';

test('the hue wheel produces a valid colour for every angle', () => {
  for (let hue = 0; hue < 360; hue += 15) {
    expect(hslToHex(hue, 68, 54)).toMatch(/^#[0-9A-F]{6}$/);
  }
});

test('white or near-black text is chosen so the accent stays readable', () => {
  for (let hue = 0; hue < 360; hue += 10) {
    const accent = accentFromHue(hue);
    const onWhite = contrastRatio(accent.accent, '#FFFFFF');
    const onBlack = contrastRatio(accent.accent, '#0B0B0F');
    // Whatever text colour the wheel picked must clear AA on the accent.
    expect(Math.max(onWhite, onBlack)).toBeGreaterThanOrEqual(4.5);
    expect(accent.onAccent === '#FFFFFF' ? onWhite : onBlack)
      .toBeGreaterThanOrEqual(4.5);
  }
});

test('the three accent roles are distinct at the same hue', () => {
  const accent = accentFromHue(200);
  expect(accent.accentSoft).not.toBe(accent.accent);
  expect(accent.accentDeep).not.toBe(accent.accent);
});

test('hues are normalised and validated', () => {
  expect(isAccentHue(0)).toBe(true);
  expect(isAccentHue(359)).toBe(true);
  expect(isAccentHue(360)).toBe(false);
  expect(isAccentHue(-1)).toBe(false);
  expect(isAccentHue(Number.NaN)).toBe(false);
  expect(accentFromHue(720).accent).toBe(accentFromHue(0).accent);
});

test('an old hex accent can be turned back into a wheel angle', () => {
  expect(hueFromHex('#6C4BEF')).toBeGreaterThan(240);
  expect(hueFromHex('#6C4BEF')).toBeLessThan(270);
  expect(hueFromHex('nope')).toBe(DEFAULT_ACCENT_HUE);
});

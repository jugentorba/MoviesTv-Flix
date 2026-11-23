import {
  elevation,
  fontFamily,
  gradients,
  gradientsFor,
  motion,
  theme,
  themes,
  typography,
} from '@moviestv/ui';

const REQUIRED_COLOR_KEYS = [
  // Legacy keys: these are imported by more than a hundred call sites.
  'background',
  'surface',
  'surfaceElevated',
  'text',
  'muted',
  'border',
  'accent',
  'accentSoft',
  'focus',
  'danger',
  // Added with the redesign.
  'surfaceOverlay',
  'subtle',
  'accentDeep',
  'highlight',
  'borderStrong',
  'success',
  'warning',
  'onAccent',
  'onMedia',
  'scrim',
] as const;

/** Relative luminance per WCAG 2.1. */
function luminance(color: string): number {
  const hex = color.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) {
    throw new Error(`Not a 6-digit hex colour: ${color}`);
  }
  const channels = [0, 2, 4].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

describe('design tokens', () => {
  it('exposes every colour the screens depend on, in every theme', () => {
    for (const [name, value] of Object.entries(themes)) {
      for (const key of REQUIRED_COLOR_KEYS) {
        const color = (value.colors as unknown as Record<string, string>)[key];
        expect(typeof color).toBe('string');
        expect(color.length).toBeGreaterThan(0);
        // Hex colours must be complete; rgba() scrims are allowed.
        if (color.startsWith('#')) {
          expect(color).toMatch(/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
        } else {
          expect(color).toMatch(/^rgba?\(/);
        }
        expect(name).toBeTruthy();
      }
    }
  });

  it('keeps `theme` pointing at the dark theme so existing imports do not change', () => {
    expect(theme).toBe(themes.dark);
    expect(theme.name).toBe('dark');
  });

  it('gives every theme the same key set, so a switch cannot leave a hole', () => {
    const reference = Object.keys(themes.dark.colors).sort();
    for (const [name, value] of Object.entries(themes)) {
      expect({ name, keys: Object.keys(value.colors).sort() }).toEqual({
        name,
        keys: reference,
      });
    }
  });

  it('keeps body text readable on the app background', () => {
    for (const [name, value] of Object.entries(themes)) {
      const ratio = contrast(value.colors.text, value.colors.background);
      expect({ name, passes: ratio >= 7 }).toEqual({ name, passes: true });
    }
  });

  it('keeps secondary text readable on cards', () => {
    for (const [name, value] of Object.entries(themes)) {
      const ratio = contrast(value.colors.muted, value.colors.surface);
      expect({ name, passes: ratio >= 4.5 }).toEqual({ name, passes: true });
    }
  });

  it('keeps text on top of the accent button readable', () => {
    for (const [name, value] of Object.entries(themes)) {
      const ratio = contrast(value.colors.onAccent, value.colors.accent);
      expect({ name, passes: ratio >= 4.5 }).toEqual({ name, passes: true });
    }
  });

  it('is no longer the red of a Netflix clone', () => {
    // A guard against quietly drifting back to the borrowed #e50914 accent.
    expect(theme.colors.accent.toLowerCase()).not.toBe('#e50914');
    const [red, , blue] = [0, 2, 4].map((offset) =>
      parseInt(theme.colors.accent.replace('#', '').slice(offset, offset + 2), 16));
    expect(blue).toBeGreaterThan(red);
  });

  it('keeps the spacing and radius scales ordered', () => {
    const spacing = Object.values(theme.spacing) as number[];
    const radii = Object.values(theme.radius) as number[];
    for (const scale of [spacing, radii]) {
      expect(scale.every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
      expect([...scale].sort((a, b) => a - b)).toEqual(scale);
    }
    // The legacy keys stay present.
    expect(theme.spacing).toMatchObject({ xs: 6, sm: 10, md: 16, lg: 24, xl: 32, xxl: 48 });
    expect(theme.radius).toMatchObject({ sm: 10, md: 14, lg: 20, pill: 999 });
  });

  it('defines a type scale with readable line heights', () => {
    for (const [name, token] of Object.entries(typography)) {
      expect({ name, has: Boolean(token.fontFamily) }).toEqual({ name, has: true });
      expect(token.fontSize).toBeGreaterThan(0);
      expect(token.lineHeight).toBeGreaterThanOrEqual(token.fontSize);
      expect(token.fontWeight).toMatch(/^(400|500|600|700)$/);
      // Display sizes must stay larger than body sizes.
      expect(token.letterSpacing).toBeGreaterThanOrEqual(-1);
    }
    expect(typography.display.fontSize).toBeGreaterThan(typography.body.fontSize);
    expect(typography.title.fontSize).toBeGreaterThan(typography.caption.fontSize);
  });

  it('names a display face distinct from the UI face', () => {
    expect(fontFamily.display).not.toBe(fontFamily.ui);
    expect(Object.values(fontFamily).every((name) => name.trim().length > 0)).toBe(true);
  });

  it('provides gradient ramps with at least two stops', () => {
    for (const [, ramp] of Object.entries(gradients)) {
      expect(ramp.length).toBeGreaterThanOrEqual(2);
    }
    // AMOLED gets a darker scrim so text does not sit on a grey wash.
    expect(gradientsFor('amoled').scrimBottom.at(-1)).not.toBe(
      gradientsFor('dark').scrimBottom.at(-1),
    );
    expect(gradientsFor('light')).toBe(gradients);
  });

  it('defines motion timings that stay short enough to feel immediate', () => {
    for (const value of Object.values(motion.duration)) {
      expect(value).toBeGreaterThanOrEqual(80);
      expect(value).toBeLessThanOrEqual(500);
    }
    expect(motion.focusScale).toBeGreaterThan(1);
    expect(motion.pressScale).toBeLessThan(1);
  });

  it('provides elevation presets with a transparent default', () => {
    expect(elevation.none).toEqual({});
    expect(elevation.card.elevation).toBeGreaterThan(0);
    expect(elevation.focused.elevation).toBeGreaterThan(elevation.card.elevation);
    expect(elevation.overlay.elevation).toBeGreaterThan(elevation.focused.elevation);
  });
});

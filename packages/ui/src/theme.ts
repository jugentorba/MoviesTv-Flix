/**
 * Design tokens.
 *
 * One palette, one type scale, one motion scale. Screens must not invent colour
 * literals: everything visible comes from here so a theme switch is one value,
 * not a sweep through forty files.
 *
 * `theme` is the dark theme and stays the default export shape that screens
 * already import. The legacy keys (`colors.text`, `colors.surface`,
 * `spacing.md`, `radius.lg`...) are preserved on purpose — they are used by
 * dozens of screens and renaming them buys nothing.
 */

export type ThemeName = 'dark' | 'amoled' | 'light';

export interface ThemeColors {
  /** App background behind all content. */
  background: string;
  /** Cards, sheets, and rows sitting on the background. */
  surface: string;
  /** A surface on top of another surface: menus, selected rows. */
  surfaceElevated: string;
  /** Highest layer: dialogs and the player chrome. */
  surfaceOverlay: string;
  /** Primary text. */
  text: string;
  /** Secondary text: metadata, descriptions, hints. */
  muted: string;
  /** Tertiary text: counts, timestamps, disabled states. */
  subtle: string;
  /** Brand accent: primary actions, active navigation, focus. */
  accent: string;
  /** Lighter accent for gradients and pressed states. */
  accentSoft: string;
  /** Deeper accent for gradients and shadows. */
  accentDeep: string;
  /** Warm secondary for ratings and "new" badges. */
  highlight: string;
  /** Hairline dividers and card outlines. */
  border: string;
  /** A border that must read as deliberate: focusable cards, selected items. */
  borderStrong: string;
  /** Keyboard/remote focus ring. */
  focus: string;
  success: string;
  warning: string;
  danger: string;
  /** Text drawn on top of the accent colour. */
  onAccent: string;
  /** Text drawn on top of artwork, always high contrast. */
  onMedia: string;
  /** Neutral scrim used under text over artwork. */
  scrim: string;
}

export interface Theme {
  name: ThemeName;
  colors: ThemeColors;
  spacing: {
    xxs: number;
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
  };
  radius: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    pill: number;
  };
}

const spacing = {
  xxs: 4,
  xs: 6,
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

const radius = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

const dark: Theme = {
  name: 'dark',
  spacing,
  radius,
  colors: {
    background: '#08080B',
    surface: '#121218',
    surfaceElevated: '#1B1B24',
    surfaceOverlay: '#24242F',
    text: '#F5F5F7',
    muted: '#A5A5B8',
    subtle: '#6F6F82',
    accent: '#6C4BEF',
    accentSoft: '#9B82FF',
    accentDeep: '#4F35C9',
    highlight: '#FF8A4C',
    border: 'rgba(255,255,255,0.09)',
    borderStrong: 'rgba(255,255,255,0.18)',
    focus: '#FFFFFF',
    success: '#2ED47A',
    warning: '#FFB020',
    danger: '#FF5A5F',
    onAccent: '#FFFFFF',
    onMedia: '#FFFFFF',
    scrim: 'rgba(8,8,11,0.72)',
  },
};

const amoled: Theme = {
  ...dark,
  name: 'amoled',
  colors: {
    ...dark.colors,
    background: '#000000',
    surface: '#0A0A0C',
    surfaceElevated: '#141418',
    surfaceOverlay: '#1C1C22',
    border: 'rgba(255,255,255,0.11)',
    scrim: 'rgba(0,0,0,0.78)',
  },
};

const light: Theme = {
  ...dark,
  name: 'light',
  colors: {
    ...dark.colors,
    background: '#F6F6F9',
    surface: '#FFFFFF',
    surfaceElevated: '#EFEFF4',
    surfaceOverlay: '#FFFFFF',
    text: '#12121A',
    muted: '#565669',
    subtle: '#8A8A9C',
    accent: '#6244E0',
    accentSoft: '#7C5CFF',
    accentDeep: '#4A31BE',
    highlight: '#D9642A',
    border: 'rgba(18,18,26,0.10)',
    borderStrong: 'rgba(18,18,26,0.20)',
    focus: '#12121A',
    success: '#128A4E',
    warning: '#9A6100',
    danger: '#C42A30',
    onMedia: '#FFFFFF',
    scrim: 'rgba(0,0,0,0.62)',
  },
};

export const themes: Record<ThemeName, Theme> = { dark, amoled, light };

/** The default theme, kept as `theme` for existing imports. */
export const theme: Theme = dark;

/**
 * Type scale.
 *
 * `fontFamily` values are the names registered by the font loader; using a name
 * that is not registered falls back to the system font, so a missing font file
 * degrades instead of crashing.
 */
export const fontFamily = {
  /** UI text: labels, body, buttons. */
  ui: 'Inter',
  uiMedium: 'Inter-Medium',
  uiSemiBold: 'Inter-SemiBold',
  uiBold: 'Inter-Bold',
  /** Display: screen titles, hero titles, the wordmark. */
  display: 'Sora-SemiBold',
  displayBold: 'Sora-Bold',
} as const;

export interface TextStyleToken {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  fontWeight: '400' | '500' | '600' | '700';
}

export const typography = {
  /** Hero title on a details screen. */
  display: {
    fontFamily: fontFamily.displayBold,
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -0.8,
    fontWeight: '700',
  },
  /** Screen title. */
  title: {
    fontFamily: fontFamily.display,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.5,
    fontWeight: '600',
  },
  /** Section heading inside a screen. */
  heading: {
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 19,
    lineHeight: 25,
    letterSpacing: -0.2,
    fontWeight: '600',
  },
  /** Row title, card title. */
  subheading: {
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: -0.1,
    fontWeight: '600',
  },
  body: {
    fontFamily: fontFamily.ui,
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: 0,
    fontWeight: '400',
  },
  bodyStrong: {
    fontFamily: fontFamily.uiMedium,
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: 0,
    fontWeight: '500',
  },
  label: {
    fontFamily: fontFamily.uiMedium,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.1,
    fontWeight: '500',
  },
  /** Small metadata: duration, year, size. */
  caption: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.1,
    fontWeight: '400',
  },
  /** Uppercase eyebrow above a section, or a badge. */
  overline: {
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.9,
    fontWeight: '600',
  },
  button: {
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: 0.1,
    fontWeight: '600',
  },
} as const satisfies Record<string, TextStyleToken>;

/** Gradient ramps for LinearGradient. */
export const gradients = {
  /** Behind text over artwork: transparent at the top, opaque at the bottom. */
  scrimBottom: ['rgba(8,8,11,0)', 'rgba(8,8,11,0.55)', 'rgba(8,8,11,0.92)'],
  /** Behind a header sitting on artwork. */
  scrimTop: ['rgba(8,8,11,0.88)', 'rgba(8,8,11,0)'],
  /** Accent-filled primary action. */
  accent: ['#7C5CFF', '#4F35C9'],
  /** Subtle card tint used for the "focused" state on TV. */
  focusGlow: ['rgba(124,92,255,0.28)', 'rgba(124,92,255,0.02)'],
} as const;

export const gradientsAmoled = {
  ...gradients,
  scrimBottom: ['rgba(0,0,0,0)', 'rgba(0,0,0,0.62)', 'rgba(0,0,0,0.96)'],
  scrimTop: ['rgba(0,0,0,0.92)', 'rgba(0,0,0,0)'],
  focusGlow: ['rgba(124,92,255,0.34)', 'rgba(124,92,255,0.02)'],
} as const;

/** Motion. Keep transitions short enough to feel instant on a remote. */
export const motion = {
  duration: { fast: 120, base: 200, slow: 320 },
  /** Scale applied to a card while focused on TV. */
  focusScale: 1.04,
  /** Scale applied while a touch target is pressed. */
  pressScale: 0.97,
  /** Elevation used by a focused card. */
  focusElevation: 6,
} as const;

/** Shadow presets. React Native Web maps these to box-shadow. */
export const elevation = {
  none: {},
  card: {
    shadowColor: '#000000',
    shadowOpacity: 0.34,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  focused: {
    shadowColor: '#7C5CFF',
    shadowOpacity: 0.42,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  overlay: {
    shadowColor: '#000000',
    shadowOpacity: 0.5,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
} as const;

/** Resolves the gradient ramp for a theme so screens never hardcode a ramp. */
export function gradientsFor(name: ThemeName) {
  return name === 'amoled' ? gradientsAmoled : gradients;
}

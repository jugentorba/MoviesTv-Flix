import AsyncStorage from '@react-native-async-storage/async-storage';

export type SubtitleSize = 'small' | 'medium' | 'large';
export type SubtitleBackground = 'off' | 'soft' | 'solid';

export type SubtitlePosition = 'low' | 'normal' | 'high';

export interface SubtitleStyle {
  size: SubtitleSize;
  background: SubtitleBackground;
  /** Vertical shift in points; positive moves the line up. */
  offset: number;
  bold: boolean;
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  size: 'medium',
  background: 'soft',
  offset: 0,
  bold: false,
};

export const SUBTITLE_OFFSETS: Record<SubtitlePosition, number> = {
  low: -48,
  normal: 0,
  high: 72,
};

/** Keeps a hand-edited or older stored offset inside the usable band. */
export function clampSubtitleOffset(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(-160, Math.min(240, Math.round(value)));
}

const STORAGE_KEY = 'moviestv:subtitle-style:v1';

const SIZES: readonly SubtitleSize[] = ['small', 'medium', 'large'];
const BACKGROUNDS: readonly SubtitleBackground[] = ['off', 'soft', 'solid'];

export function isSubtitleSize(value: unknown): value is SubtitleSize {
  return SIZES.includes(value as SubtitleSize);
}

export function isSubtitleBackground(value: unknown): value is SubtitleBackground {
  return BACKGROUNDS.includes(value as SubtitleBackground);
}

/** Anything unreadable falls back to the default rather than breaking captions. */
export function normalizeSubtitleStyle(value: unknown): SubtitleStyle {
  if (!value || typeof value !== 'object') return DEFAULT_SUBTITLE_STYLE;
  const record = value as Partial<SubtitleStyle>;
  return {
    size: isSubtitleSize(record.size) ? record.size : DEFAULT_SUBTITLE_STYLE.size,
    background: isSubtitleBackground(record.background)
      ? record.background
      : DEFAULT_SUBTITLE_STYLE.background,
    offset: clampSubtitleOffset(record.offset),
    bold: typeof record.bold === 'boolean' ? record.bold : false,
  };
}

export interface SubtitleMetrics {
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '700';
  backgroundColor: string;
  paddingHorizontal: number;
  paddingVertical: number;
  borderRadius: number;
}

/**
 * Captions are read at arm's length on a phone and across a room on a TV, so the
 * size scales the type *and* its line height together — a larger font with the
 * old line height clips accents on languages like French and Vietnamese.
 */
export function subtitleMetrics(style: SubtitleStyle): SubtitleMetrics {
  const type = style.size === 'small'
    ? { fontSize: 17, lineHeight: 23 }
    : style.size === 'large'
      ? { fontSize: 27, lineHeight: 35 }
      : { fontSize: 21, lineHeight: 28 };

  const background = style.background === 'solid'
    ? {
      backgroundColor: 'rgba(0,0,0,0.86)',
      paddingHorizontal: 12,
      paddingVertical: 4,
      borderRadius: 6,
    }
    : style.background === 'soft'
      ? {
        backgroundColor: 'rgba(0,0,0,0.42)',
        paddingHorizontal: 10,
        paddingVertical: 3,
        borderRadius: 6,
      }
      : {
        backgroundColor: 'transparent',
        paddingHorizontal: 0,
        paddingVertical: 0,
        borderRadius: 0,
      };

  return {
    ...type,
    ...background,
    fontWeight: style.bold ? '700' : '400',
  };
}

export async function readSubtitleStyle(): Promise<SubtitleStyle> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SUBTITLE_STYLE;
    return normalizeSubtitleStyle(JSON.parse(raw));
  } catch {
    return DEFAULT_SUBTITLE_STYLE;
  }
}

export async function writeSubtitleStyle(style: SubtitleStyle): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeSubtitleStyle(style)));
  } catch {
    // Best effort: the session still uses the chosen style.
  }
}

export const SUBTITLE_STYLE_STORAGE_KEY = STORAGE_KEY;

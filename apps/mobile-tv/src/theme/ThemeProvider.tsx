import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  accentFromHue,
  DEFAULT_ACCENT_HUE,
  hueFromHex,
  isAccentHue,
  themes,
  type Theme,
  type ThemeName,
} from '@moviestv/ui';

const STORAGE_KEY = 'moviestv:theme:v1';
const ACCENT_STORAGE_KEY = 'moviestv:accent-hue:v1';
const LEGACY_ACCENT_STORAGE_KEY = 'moviestv:accent:v1';

/** The six names the app shipped before the wheel, so an old choice survives. */
const LEGACY_ACCENT_COLOURS: Record<string, string> = {
  violet: '#6C4BEF',
  blue: '#2563EB',
  teal: '#0F766E',
  magenta: '#BE185D',
  amber: '#B45309',
  crimson: '#B91C1C',
};

function isThemeName(value: unknown): value is ThemeName {
  return value === 'dark' || value === 'amoled' || value === 'light';
}

interface ThemeContextValue {
  theme: Theme;
  themeName: ThemeName;
  setThemeName(name: ThemeName): void;
  /** 0–359 around the colour wheel. */
  accentHue: number;
  setAccentHue(hue: number): void;
  ready: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Applies the selected theme and accent, remembers both on this device.
 *
 * The choices are deliberately device-local rather than synced preferences: a
 * phone may want AMOLED while the TV in a bright room wants the lighter dark
 * theme, and shipping a theme through the sync payload would force them to
 * agree.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeName, setThemeNameState] = useState<ThemeName>('dark');
  const [accentHue, setAccentHueState] = useState<number>(DEFAULT_ACCENT_HUE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [stored, storedHue, legacyName] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY),
          AsyncStorage.getItem(ACCENT_STORAGE_KEY),
          AsyncStorage.getItem(LEGACY_ACCENT_STORAGE_KEY),
        ]);
        if (cancelled) return;
        if (isThemeName(stored)) setThemeNameState(stored);

        const parsedHue = storedHue === null ? Number.NaN : Number(storedHue);
        if (isAccentHue(parsedHue)) {
          setAccentHueState(parsedHue);
        } else if (legacyName && LEGACY_ACCENT_COLOURS[legacyName]) {
          // One-time migration from the named presets.
          setAccentHueState(hueFromHex(LEGACY_ACCENT_COLOURS[legacyName]));
        }
      } catch {
        // A failed read must not block the app; the defaults apply.
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const setThemeName = useCallback((next: ThemeName) => {
    setThemeNameState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {
      // Persisting is best-effort; the session still uses the new theme.
    });
  }, []);

  const setAccentHue = useCallback((next: number) => {
    const safe = Number.isFinite(next) ? ((Math.round(next) % 360) + 360) % 360 : DEFAULT_ACCENT_HUE;
    setAccentHueState(safe);
    void AsyncStorage.setItem(ACCENT_STORAGE_KEY, String(safe)).catch(() => {
      // Best effort.
    });
  }, []);

  const theme = useMemo<Theme>(() => {
    const base = themes[themeName];
    const accent = accentFromHue(accentHue);
    return {
      ...base,
      colors: {
        ...base.colors,
        accent: accent.accent,
        accentSoft: accent.accentSoft,
        accentDeep: accent.accentDeep,
        onAccent: accent.onAccent,
      },
    };
  }, [accentHue, themeName]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, themeName, setThemeName, accentHue, setAccentHue, ready }),
    [accentHue, ready, setAccentHue, theme, themeName, setThemeName],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * The active theme.
 *
 * Falls back to the default dark theme outside a provider rather than throwing:
 * screens are rendered in isolation by tests, and a component must never fail
 * because of how it was mounted. The controller below is the strict variant,
 * because writing a theme without a provider would silently do nothing.
 */
export function useTheme(): Theme {
  return useContext(ThemeContext)?.theme ?? themes.dark;
}

export function useThemeController(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useThemeController must be used inside ThemeProvider');
  return value;
}

/**
 * Builds a themed StyleSheet once per theme.
 *
 * `StyleSheet.create` resolves colours at module load, so a module-level sheet
 * cannot follow a theme switch. Screens pass a factory instead:
 *
 *   const createStyles = (theme: Theme) => StyleSheet.create({ ... });
 *   const styles = useThemeStyles(createStyles);
 */
export function useThemeStyles<T>(factory: (theme: Theme) => T): T {
  const theme = useTheme();
  return useMemo(() => factory(theme), [factory, theme]);
}

export { STORAGE_KEY as THEME_STORAGE_KEY, ACCENT_STORAGE_KEY as ACCENT_HUE_STORAGE_KEY };

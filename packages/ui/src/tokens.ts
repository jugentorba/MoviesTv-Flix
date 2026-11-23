/**
 * Compatibility surface for screens that import `colors` and `spacing`
 * directly instead of going through `theme`.
 *
 * Kept as a thin projection of the default theme so there is exactly one place
 * where a colour is defined. New code should use `theme.colors`.
 */
import { theme } from './theme';

export const colors = {
  background: theme.colors.background,
  surface: theme.colors.surface,
  primary: theme.colors.accent,
  text: theme.colors.text,
  muted: theme.colors.muted,
  focus: theme.colors.focus,
} as const;

export const spacing = theme.spacing;

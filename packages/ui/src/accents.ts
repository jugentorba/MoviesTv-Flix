/**
 * Accent colour maths for the wheel picker.
 *
 * The user can pick any hue, so the text colour on the accent cannot be a fixed
 * white: a yellow accent needs dark text to stay legible. `onAccent` is derived
 * from the WCAG contrast ratio, which keeps every hue usable instead of the six
 * pre-verified swatches the app shipped before.
 */
export const DEFAULT_ACCENT_HUE = 253;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function componentToHex(value: number): string {
  const hex = clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
  return hex.toUpperCase();
}

export function hslToHex(hue: number, saturation: number, lightness: number): string {
  const h = ((hue % 360) + 360) % 360;
  const s = clamp(saturation, 0, 100) / 100;
  const l = clamp(lightness, 0, 100) / 100;

  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const segment = h / 60;
  const second = chroma * (1 - Math.abs((segment % 2) - 1));
  const match = l - chroma / 2;

  let r = 0;
  let g = 0;
  let b = 0;
  if (segment < 1) [r, g, b] = [chroma, second, 0];
  else if (segment < 2) [r, g, b] = [second, chroma, 0];
  else if (segment < 3) [r, g, b] = [0, chroma, second];
  else if (segment < 4) [r, g, b] = [0, second, chroma];
  else if (segment < 5) [r, g, b] = [second, 0, chroma];
  else [r, g, b] = [chroma, 0, second];

  return `#${componentToHex((r + match) * 255)}${componentToHex((g + match) * 255)}${componentToHex((b + match) * 255)}`;
}

/** WCAG relative luminance of a #RRGGBB colour. */
export function relativeLuminance(hex: string): number {
  const value = hex.trim().replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(value)) return 0;
  const channels = [0, 2, 4].map((offset) => {
    const raw = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return raw <= 0.03928 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

export interface AccentColours {
  accent: string;
  accentSoft: string;
  accentDeep: string;
  /** Text drawn on the accent: white unless the accent is too light for it. */
  onAccent: string;
}

export function accentFromHue(hue: number): AccentColours {
  const safeHue = Number.isFinite(hue) ? ((Math.round(hue) % 360) + 360) % 360 : DEFAULT_ACCENT_HUE;

  // Start from a vivid tone, then pick whichever text colour reads better. A
  // few hues (mid yellows and greens) miss AA both ways at this lightness, so
  // darken only those until white text clears the floor — the hue survives.
  let lightness = 54;
  let accent = hslToHex(safeHue, 68, lightness);
  let onWhite = contrastRatio(accent, '#FFFFFF');
  let onBlack = contrastRatio(accent, '#0B0B0F');
  while (Math.max(onWhite, onBlack) < 4.5 && lightness > 26) {
    lightness -= 4;
    accent = hslToHex(safeHue, 68, lightness);
    onWhite = contrastRatio(accent, '#FFFFFF');
    onBlack = contrastRatio(accent, '#0B0B0F');
  }

  return {
    accent,
    accentSoft: hslToHex(safeHue, 78, Math.min(72, lightness + 14)),
    accentDeep: hslToHex(safeHue, 62, Math.max(28, lightness - 12)),
    onAccent: onWhite >= onBlack ? '#FFFFFF' : '#0B0B0F',
  };
}

export function isAccentHue(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value < 360;
}

/** Hue of an existing hex accent, so a stored colour can become a wheel angle. */
export function hueFromHex(hex: string): number {
  const value = hex.trim().replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(value)) return DEFAULT_ACCENT_HUE;
  const r = Number.parseInt(value.slice(0, 2), 16) / 255;
  const g = Number.parseInt(value.slice(2, 4), 16) / 255;
  const b = Number.parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return DEFAULT_ACCENT_HUE;

  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return Math.round((hue * 60 + 360) % 360);
}

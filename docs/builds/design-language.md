# Design language

The visual system lives in `packages/ui/src/theme.ts`. Screens import `theme`
and must not invent colour literals — a theme switch has to be one value, not a
sweep through forty files.

## Why it looked dated

Measured across the app before this change:

- **No icon library.** Navigation used text glyphs (`⌂`, `●`, `▤`, `▰`, `⌕`,
  `⚙`) typed into the label. They inherit the system font, so weight and
  optical size vary per glyph and per platform.
- **No custom font.** Everything rendered in the system default.
- **One hardcoded palette**: `#09090b` background with `#e50914`, the red
  Netflix uses. No elevation, no gradients, no secondary or tertiary text
  levels, no semantic colours.

Those three facts explain "black and white with washed-out icons" better than
any statement about layout.

## Tokens

| Group | Contents |
| --- | --- |
| Colour | 20 named roles: background, surface, surfaceElevated, surfaceOverlay, text, muted, subtle, accent, accentSoft, accentDeep, highlight, border, borderStrong, focus, success, warning, danger, onAccent, onMedia, scrim |
| Themes | `dark` (default), `amoled` (true black), `light` |
| Type | display, title, heading, subheading, body, bodyStrong, label, caption, overline, button |
| Spacing | 4, 6, 10, 16, 24, 32, 48 |
| Radius | 6, 10, 14, 20, 28, pill |
| Motion | 120 / 200 / 320 ms, focus scale 1.04, press scale 0.97 |
| Elevation | card, focused, overlay |
| Gradients | scrimBottom, scrimTop, accent, focusGlow |

## Type

- **Inter** for UI text — designed for interfaces at small sizes.
- **Sora** for display — a geometric face with more character than a system
  font, so titles read as designed rather than default.

Font family names are registered by the loader. A name that is not registered
falls back to the system font, so a missing font file degrades instead of
crashing.

## Contrast is enforced, not claimed

`apps/mobile-tv/src/__tests__/design-tokens.test.ts` computes WCAG ratios and
fails the build when:

- body text on the app background drops below 7:1 (AAA)
- secondary text on a card drops below 4.5:1
- text on the accent button drops below 4.5:1
- a theme is missing a colour role, so a switch cannot leave a hole
- the accent drifts back to the borrowed Netflix red

The dark accent is `#6C4BEF` rather than a brighter violet because the lighter
value measured 4.35:1 against white — just under AA for body text.

## Rules for screens

1. Colour comes from `theme.colors`, never a literal.
2. Text uses a `typography` token, never an ad-hoc font size.
3. A tappable card has a focus state (TV) and a press state (touch), both from
   `motion`.
4. Text over artwork sits on a `gradients.scrim*` ramp, never on the raw image.
5. New copy goes in `i18n/resources/screens.ts` for en, sq, fr and de.

## Status

Tokens and themes are in place and covered by 13 tests. Screens still consume
the legacy keys (`theme.colors.text`, `spacing.md`), which are preserved on
purpose; migrating them to the new tokens is the next phase.

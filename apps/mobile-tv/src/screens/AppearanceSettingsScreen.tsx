import React, { useContext, useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import {
  accentFromHue,
  DEFAULT_ACCENT_HUE,
  fontFamily,
  themes,
  type Theme,
  type ThemeName,
} from '@moviestv/ui';
import { useI18n } from '../i18n/useI18n';
import { useThemeController, useThemeStyles } from '../theme/ThemeProvider';
import { SettingsCard, SettingsLabel, SettingsPage } from '../components/SettingsPage';
import { ColourWheel } from '../components/ColourWheel';
import {
  DEFAULT_SUBTITLE_STYLE,
  readSubtitleStyle,
  SUBTITLE_OFFSETS,
  subtitleMetrics,
  writeSubtitleStyle,
  type SubtitleBackground,
  type SubtitlePosition,
  type SubtitleSize,
  type SubtitleStyle,
} from '../playback/subtitleStyle';

const ORDER: ThemeName[] = ['dark', 'amoled', 'light'];

export function AppearanceSettingsScreen({ onBack }: { onBack(): void }) {
  const { t } = useI18n();
  const { themeName, setThemeName, accentHue, setAccentHue } = useThemeController();
  const styles = useThemeStyles(createStyles);
  const insets = useContext(SafeAreaInsetsContext) ?? {
    top: 0, right: 0, bottom: 0, left: 0,
  };
  const [subtitleStyle, setSubtitleStyle] =
    useState<SubtitleStyle>(DEFAULT_SUBTITLE_STYLE);

  useEffect(() => {
    let active = true;
    void readSubtitleStyle().then((style) => { if (active) setSubtitleStyle(style); });
    return () => { active = false; };
  }, []);

  const updateSubtitleStyle = (next: Partial<SubtitleStyle>) => {
    const merged = { ...subtitleStyle, ...next };
    setSubtitleStyle(merged);
    void writeSubtitleStyle(merged);
  };

  const accent = accentFromHue(accentHue);

  return (
    <SettingsPage
      testID="appearance-screen"
      eyebrow={t('appearance.eyebrow')}
      title={t('appearance.title')}
      intro={t('appearance.subtitle')}
      backLabel={t('nav.settings')}
      onBack={onBack}
      closeLabel={t('playback.close')}
      onClose={onBack}
    >
      <SettingsCard>
        <SettingsLabel>{t('appearance.colour')}</SettingsLabel>
        <ColourWheel hue={accentHue} onChange={setAccentHue} />
        <Text style={styles.hint}>{t('appearance.colourHint')}</Text>
        <Pressable
          accessibilityRole="button"
          testID="appearance-accent-default"
          onPress={() => setAccentHue(DEFAULT_ACCENT_HUE)}
          style={({ pressed }) => [styles.resetPill, pressed && styles.pressed]}
        >
          <View style={[styles.resetDot, { backgroundColor: accentFromHue(DEFAULT_ACCENT_HUE).accent }]} />
          <Text style={styles.resetText}>{t('appearance.classicViolet')}</Text>
        </Pressable>
        <View style={[styles.previewStrip, { backgroundColor: accent.accent }]}>
          <Ionicons name="checkmark-circle" size={16} color={accent.onAccent} />
          <Text style={[styles.previewText, { color: accent.onAccent }]}>
            {t('appearance.accentPreview')}
          </Text>
        </View>
      </SettingsCard>

      <SettingsCard>
        <SettingsLabel>{t('appearance.lightDark')}</SettingsLabel>
        <Text style={styles.hint}>{t('appearance.lightDarkHint')}</Text>
        {ORDER.map((name) => {
          const preview = themes[name];
          const selected = name === themeName;
          return (
            <Pressable
              key={name}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              testID={`appearance-${name}`}
              onPress={() => setThemeName(name)}
              style={({ focused, pressed }) => [
                styles.option,
                { backgroundColor: preview.colors.surfaceElevated, borderColor: preview.colors.border },
                selected && { borderColor: accent.accent },
                focused && styles.focused,
                pressed && styles.pressed,
              ]}
            >
              <View style={[styles.swatch, { backgroundColor: preview.colors.background }]}>
                <View style={[styles.swatchCard, { backgroundColor: preview.colors.surfaceElevated }]} />
                <View style={[styles.swatchAccent, { backgroundColor: accent.accent }]} />
              </View>
              <View style={styles.optionCopy}>
                <Text style={[styles.optionLabel, { color: preview.colors.text }]}>
                  {t(`appearance.${name}`)}
                </Text>
                <Text style={[styles.optionDetail, { color: preview.colors.muted }]}>
                  {t(`appearance.${name}Detail`)}
                </Text>
              </View>
              <Ionicons
                name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                size={22}
                color={selected ? accent.accent : preview.colors.subtle}
              />
            </Pressable>
          );
        })}
      </SettingsCard>

      <SettingsCard>
        <SettingsLabel>{t('appearance.subtitles')}</SettingsLabel>

        <Text style={styles.groupLabel}>{t('appearance.subtitleSize')}</Text>
        <View style={styles.chipRow}>
          {(['small', 'medium', 'large'] as SubtitleSize[]).map((size) => {
            const selected = subtitleStyle.size === size;
            return (
              <Pressable
                key={size}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                testID={`appearance-subtitle-size-${size}`}
                onPress={() => updateSubtitleStyle({ size })}
                style={({ focused, pressed }) => [
                  styles.chip,
                  selected && { backgroundColor: accent.accent, borderColor: accent.accent },
                  focused && styles.focused,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.chipText, selected && { color: accent.onAccent }]}>
                  {t(`appearance.subtitle${size === 'small' ? 'Small' : size === 'large' ? 'Large' : 'Medium'}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.groupLabel}>{t('appearance.subtitleBackground')}</Text>
        <View style={styles.chipRow}>
          {(['off', 'soft', 'solid'] as SubtitleBackground[]).map((background) => {
            const selected = subtitleStyle.background === background;
            return (
              <Pressable
                key={background}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                testID={`appearance-subtitle-background-${background}`}
                onPress={() => updateSubtitleStyle({ background })}
                style={({ focused, pressed }) => [
                  styles.chip,
                  selected && { backgroundColor: accent.accent, borderColor: accent.accent },
                  focused && styles.focused,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.chipText, selected && { color: accent.onAccent }]}>
                  {t(`appearance.background${background === 'off' ? 'Off' : background === 'solid' ? 'Solid' : 'Soft'}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.groupLabel}>{t('appearance.subtitlePosition')}</Text>
        <View style={styles.chipRow}>
          {(['low', 'normal', 'high'] as SubtitlePosition[]).map((position) => {
            const selected = subtitleStyle.offset === SUBTITLE_OFFSETS[position];
            return (
              <Pressable
                key={position}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                testID={`appearance-subtitle-position-${position}`}
                onPress={() => updateSubtitleStyle({ offset: SUBTITLE_OFFSETS[position] })}
                style={({ focused, pressed }) => [
                  styles.chip,
                  selected && { backgroundColor: accent.accent, borderColor: accent.accent },
                  focused && styles.focused,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.chipText, selected && { color: accent.onAccent }]}>
                  {t(`appearance.position${position === 'low' ? 'Low' : position === 'high' ? 'High' : 'Normal'}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: subtitleStyle.bold }}
          testID="appearance-subtitle-bold"
          onPress={() => updateSubtitleStyle({ bold: !subtitleStyle.bold })}
          style={({ pressed }) => [styles.boldRow, pressed && styles.pressed]}
        >
          <Text style={styles.groupLabel}>{t('appearance.subtitleBold')}</Text>
          <View style={[styles.switchTrack, subtitleStyle.bold && styles.switchTrackOn]}>
            <View style={[styles.switchKnob, subtitleStyle.bold && styles.switchKnobOn]} />
          </View>
        </Pressable>

        <View style={styles.subtitlePreview}>
          <Text style={[styles.subtitlePreviewText, subtitleMetrics(subtitleStyle)]}>
            {t('appearance.subtitlePreview')}
          </Text>
        </View>
      </SettingsCard>

      <Text style={[styles.note, { paddingBottom: insets.bottom > 0 ? 0 : 8 }]}>
        {t('appearance.note')}
      </Text>
    </SettingsPage>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  hint: {
    color: theme.colors.muted,
    fontFamily: fontFamily.ui,
    fontSize: 13,
    lineHeight: 19,
  },
  resetPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceElevated,
  },
  resetDot: { width: 12, height: 12, borderRadius: 6 },
  resetText: { color: theme.colors.text, fontFamily: fontFamily.uiMedium, fontSize: 13 },
  previewStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 14,
  },
  previewText: { fontFamily: fontFamily.uiSemiBold, fontSize: 13 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  swatch: {
    width: 52,
    height: 40,
    borderRadius: 10,
    padding: 5,
    justifyContent: 'space-between',
  },
  swatchCard: { height: 8, borderRadius: 4, width: '70%' },
  swatchAccent: { height: 8, borderRadius: 4, width: 18 },
  optionCopy: { flex: 1, gap: 2 },
  optionLabel: { fontFamily: fontFamily.uiSemiBold, fontSize: 15 },
  optionDetail: { fontFamily: fontFamily.ui, fontSize: 12 },
  groupLabel: {
    color: theme.colors.subtle,
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceElevated,
  },
  chipText: { color: theme.colors.text, fontFamily: fontFamily.uiMedium, fontSize: 13 },
  boldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  switchTrack: {
    width: 46,
    height: 28,
    borderRadius: 14,
    padding: 3,
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: theme.colors.border,
    justifyContent: 'center',
  },
  switchTrackOn: { backgroundColor: '#ffffff', borderColor: '#ffffff' },
  switchKnob: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: theme.colors.muted,
  },
  switchKnobOn: { alignSelf: 'flex-end', backgroundColor: '#0b0b0f' },
  subtitlePreview: {
    marginTop: 4,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#3A3A44',
    alignItems: 'center',
  },
  subtitlePreviewText: {
    color: '#ffffff',
    fontFamily: fontFamily.uiMedium,
    textAlign: 'center',
    maxWidth: 620,
  },
  note: {
    color: theme.colors.subtle,
    fontFamily: fontFamily.ui,
    fontSize: 12,
    lineHeight: 18,
  },
  focused: { borderColor: theme.colors.focus },
  pressed: { opacity: 0.7 },
});

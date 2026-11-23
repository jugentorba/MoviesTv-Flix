import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LANGUAGE_DEFINITIONS } from '@moviestv/core';
import { colors, spacing, type Theme } from '@moviestv/ui';
import { useI18n } from '../i18n/useI18n';
import { IconBackButton } from '../components/IconBackButton';
import { useSwipeBack } from '../components/useSwipeBack';
import { LanguageSearchList, type LanguageOption } from './LanguageSearchList';
import { addLanguage, moveLanguage, removeLanguage } from './language-view-model';
import { useThemeStyles } from '../theme/ThemeProvider';

export function OrderedLanguageScreen({
  kind,
  selected,
  onChange,
  subtitlesEnabled,
  onSubtitlesEnabledChange,
  onBack,
}: {
  kind: 'audio' | 'subtitle';
  selected: string[];
  onChange(value: string[]): void;
  subtitlesEnabled?: boolean;
  onSubtitlesEnabledChange?(value: boolean): void;
  onBack(): void;
}) {
  const styles = useThemeStyles(createStyles);
  const { languageName, t } = useI18n();
  const swipeHandlers = useSwipeBack(onBack);
  const options = useMemo<LanguageOption[]>(() => (
    LANGUAGE_DEFINITIONS.map((language) => ({
      tag: language.canonicalTag,
      label: languageName(language.canonicalTag),
      secondary: language.nativeName,
      searchText: [language.englishName, ...language.aliases].join(' '),
    }))
  ), [languageName]);
  const available = useMemo(
    () => options.filter((option) => !selected.includes(option.tag)),
    [options, selected],
  );

  const title = kind === 'audio'
    ? t('settings.audioLanguages')
    : t('settings.subtitleLanguages');

  return (
    <View style={styles.screen} {...swipeHandlers}>
      <View style={styles.header}>
        <IconBackButton
          label={t('common.back')}
          onPress={onBack}
          testID="ordered-language-back"
        />
        <Text style={styles.title}>{title}</Text>
      </View>

      {kind === 'subtitle' && onSubtitlesEnabledChange ? (
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: subtitlesEnabled ?? true }}
          testID="subtitles-enabled-toggle"
          onPress={() => onSubtitlesEnabledChange(!(subtitlesEnabled ?? true))}
          style={({ focused }) => [styles.toggle, focused && styles.focused]}
        >
          <Text style={styles.optionText}>{t('settings.subtitlesEnabled')}</Text>
          <Text style={styles.secondaryText}>{(subtitlesEnabled ?? true) ? '✓' : '—'}</Text>
        </Pressable>
      ) : null}

      <View style={styles.selectedList}>
        {selected.map((tag, index) => (
          <View key={tag} style={styles.selectedRow}>
            <Text style={styles.rank}>{index + 1}</Text>
            <Text style={styles.selectedLabel}>{languageName(tag)}</Text>
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                testID={`language-move-up-${tag}`}
                disabled={index === 0}
                onPress={() => onChange(moveLanguage(selected, tag, -1))}
                style={({ focused }) => [styles.action, focused && styles.focused]}
              >
                <Text style={styles.buttonText}>{t('settings.moveUp')}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                testID={`language-move-down-${tag}`}
                disabled={index === selected.length - 1}
                onPress={() => onChange(moveLanguage(selected, tag, 1))}
                style={({ focused }) => [styles.action, focused && styles.focused]}
              >
                <Text style={styles.buttonText}>{t('settings.moveDown')}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                testID={`language-remove-${tag}`}
                onPress={() => onChange(removeLanguage(selected, tag))}
                style={({ focused }) => [styles.action, focused && styles.focused]}
              >
                <Text style={styles.buttonText}>{t('settings.remove')}</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>

      <LanguageSearchList
        options={available}
        onSelect={(tag) => onChange(addLanguage(selected, tag))}
      />
    </View>
  );
}

const createStyles = (_theme: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  headerButton: { padding: spacing.sm, borderRadius: 8 },
  title: { color: colors.text, fontSize: 28, fontWeight: '700' },
  buttonText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  optionText: { color: colors.text, fontSize: 18, fontWeight: '600' },
  secondaryText: { color: colors.muted, fontSize: 18 },
  toggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'transparent',
    marginBottom: spacing.md,
  },
  selectedList: { gap: spacing.sm, marginBottom: spacing.lg },
  selectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 10,
  },
  rank: { color: colors.muted, width: 28, textAlign: 'center', fontWeight: '700' },
  selectedLabel: { color: colors.text, flex: 1, fontSize: 17, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: spacing.xs },
  action: {
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  focused: { borderColor: colors.focus },
});

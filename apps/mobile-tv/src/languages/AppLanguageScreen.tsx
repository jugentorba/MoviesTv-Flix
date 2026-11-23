import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, type Theme } from '@moviestv/ui';
import { SUPPORTED_APP_LOCALES } from '../i18n/resources';
import { useI18n } from '../i18n/useI18n';
import { IconBackButton } from '../components/IconBackButton';
import { useSwipeBack } from '../components/useSwipeBack';
import { LanguageSearchList, type LanguageOption } from './LanguageSearchList';
import { useThemeStyles } from '../theme/ThemeProvider';

export function AppLanguageScreen({
  selected,
  onSelect,
  onBack,
}: {
  selected: string | 'system';
  onSelect(value: string | 'system'): void;
  onBack(): void;
}) {
  const styles = useThemeStyles(createStyles);
  const { languageName, t } = useI18n();
  const swipeHandlers = useSwipeBack(onBack);
  const options = useMemo<LanguageOption[]>(() => (
    SUPPORTED_APP_LOCALES.map((tag) => ({
      tag,
      label: languageName(tag),
      searchText: tag,
    }))
  ), [languageName]);

  return (
    <View style={styles.screen} {...swipeHandlers}>
      <View style={styles.header}>
        <IconBackButton
          label={t('common.back')}
          onPress={onBack}
          testID="app-language-back"
        />
        <Text style={styles.title}>{t('settings.appLanguage')}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: selected === 'system' }}
        testID="app-language-system"
        onPress={() => onSelect('system')}
        style={({ focused }) => [
          styles.deviceOption,
          selected === 'system' && styles.selected,
          focused && styles.focused,
        ]}
      >
        <Text style={styles.optionText}>{t('settings.followDevice')}</Text>
      </Pressable>
      <LanguageSearchList
        options={options}
        selectedTags={selected === 'system' ? [] : [selected]}
        onSelect={onSelect}
        testIdPrefix="app-language"
      />
    </View>
  );
}

const createStyles = (_theme: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  headerButton: { padding: spacing.sm, borderRadius: 8 },
  buttonText: { color: colors.text, fontSize: 16, fontWeight: '600' },
  title: { color: colors.text, fontSize: 28, fontWeight: '700' },
  deviceOption: {
    minHeight: 54,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'transparent',
    marginBottom: spacing.md,
  },
  selected: { backgroundColor: colors.surface },
  focused: { borderColor: colors.focus },
  optionText: { color: colors.text, fontSize: 18, fontWeight: '600' },
});

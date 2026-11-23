import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, spacing, type Theme } from '@moviestv/ui';
import { useI18n } from '../i18n/useI18n';
import { useThemeStyles } from '../theme/ThemeProvider';

export interface LanguageOption {
  tag: string;
  label: string;
  secondary?: string;
  searchText?: string;
}

export function LanguageSearchList({
  options,
  onSelect,
  selectedTags = [],
  testIdPrefix = 'language',
}: {
  options: readonly LanguageOption[];
  onSelect(tag: string): void;
  selectedTags?: readonly string[];
  testIdPrefix?: string;
}) {
  const styles = useThemeStyles(createStyles);
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return options;
    return options.filter((option) => (
      `${option.label} ${option.secondary ?? ''} ${option.searchText ?? ''} ${option.tag}`
        .toLocaleLowerCase()
        .includes(needle)
    ));
  }, [options, query]);

  return (
    <View style={styles.listArea}>
      <TextInput
        accessibilityLabel={t('settings.languageSearch')}
        placeholder={t('settings.languageSearch')}
        placeholderTextColor={colors.muted}
        value={query}
        onChangeText={setQuery}
        style={styles.search}
      />
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.tag}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          const selected = selectedTags.includes(item.tag);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected }}
              testID={`${testIdPrefix}-${item.tag}`}
              onPress={() => onSelect(item.tag)}
              style={({ focused }) => [
                styles.option,
                selected && styles.selected,
                focused && styles.focused,
              ]}
            >
              <Text style={styles.label}>{item.label}</Text>
              {item.secondary && item.secondary !== item.label ? (
                <Text style={styles.secondary}>{item.secondary}</Text>
              ) : null}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const createStyles = (_theme: Theme) => StyleSheet.create({
  listArea: { flex: 1, minHeight: 240 },
  search: {
    color: colors.text,
    backgroundColor: colors.surface,
    borderColor: colors.muted,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  option: {
    minHeight: 54,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'transparent',
    marginBottom: spacing.xs,
  },
  selected: { backgroundColor: colors.surface },
  focused: { borderColor: colors.focus },
  label: { color: colors.text, fontSize: 18, fontWeight: '600' },
  secondary: { color: colors.muted, fontSize: 14, marginTop: 2 },
});

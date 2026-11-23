import React, { useEffect, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  decodeProviderSetupCode,
  encodeProviderSetupCode,
  ProviderSetupCodeError,
} from '@moviestv/addons';
import { type Theme } from '@moviestv/ui';
import { useI18n } from '../i18n/useI18n';
import { useSwipeBack } from '../components/useSwipeBack';
import { useAddons } from './useAddons';
import { useTheme, useThemeStyles } from '../theme/ThemeProvider';

/**
 * Moves configured provider links between devices without a server.
 *
 * Sync cannot carry these values (a configured add-on URL can embed a debrid
 * key), so this screen turns them into one code the user copies by hand. Nothing
 * is written to storage or sent over the network.
 */
export function ProviderTransferScreen({ onBack }: { onBack(): void }) {
  const styles = useThemeStyles(createStyles);
  const theme = useTheme();
  const addons = useAddons();
  const { t, direction } = useI18n();
  const [code, setCode] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const read = addons.exportProviderSetup?.();
    if (!read) {
      setCodeError(t('providers.transferEmpty'));
      return () => { active = false; };
    }
    void read.then((entries) => {
      if (!active) return;
      if (entries.length === 0) {
        setCodeError(t('providers.transferEmpty'));
        return;
      }
      try {
        setCode(encodeProviderSetupCode(entries));
        setCodeError(null);
      } catch (cause) {
        setCodeError(cause instanceof ProviderSetupCodeError
          ? cause.message
          : t('providers.transferEmpty'));
      }
    }).catch(() => {
      if (active) setCodeError(t('providers.transferEmpty'));
    });
    return () => { active = false; };
  }, [addons, t]);

  const apply = async () => {
    if (busy) return;
    setBusy(true);
    setApplyError(null);
    setResult(null);
    try {
      const entries = decodeProviderSetupCode(paste);
      const applied = await addons.applyProviderSetup?.(entries);
      if (!applied) {
        setApplyError(t('common.unavailable'));
        return;
      }
      setResult([
        applied.applied > 0 ? t('providers.transferResult', { count: applied.applied }) : null,
        applied.skipped > 0 ? t('providers.transferSkipped', { count: applied.skipped }) : null,
      ].filter(Boolean).join(' '));
      if (applied.applied > 0) setPaste('');
    } catch (cause) {
      setApplyError(cause instanceof ProviderSetupCodeError
        ? cause.message
        : t('common.unavailable'));
    } finally {
      setBusy(false);
    }
  };

  const swipeHandlers = useSwipeBack(onBack);

  return (
    <ScrollView
      testID="provider-transfer-screen"
      {...swipeHandlers}
      style={styles.screen}
      contentContainerStyle={[styles.content, { direction }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.header, { flexDirection: direction === 'rtl' ? 'row-reverse' : 'row' }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          testID="provider-transfer-back"
          onPress={onBack}
          style={({ focused, pressed }) => [
            styles.backButton,
            focused && styles.focused,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="chevron-back" size={24} color={theme.colors.text} />
        </Pressable>
        <Text style={[styles.title, { writingDirection: direction }]}>
          {t('providers.transferTitle')}
        </Text>
      </View>

      <Text style={[styles.hint, { writingDirection: direction }]}>
        {t('providers.transferHint')}
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('providers.transferExport')}</Text>
        {code ? (
          <Text selectable testID="provider-transfer-code" style={styles.code}>
            {code}
          </Text>
        ) : (
          <Text testID="provider-transfer-empty" style={styles.muted}>
            {codeError ?? t('common.loading')}
          </Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('providers.transferPaste')}</Text>
        <TextInput
          testID="provider-transfer-input"
          value={paste}
          onChangeText={setPaste}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="MTFLIX-SETUP-1:…"
          placeholderTextColor={theme.colors.subtle}
          style={styles.input}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('providers.transferApply')}
          testID="provider-transfer-apply"
          disabled={busy || !paste.trim()}
          onPress={() => { void apply(); }}
          style={({ focused, pressed }) => [
            styles.apply,
            (busy || !paste.trim()) && styles.disabled,
            focused && styles.focused,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.applyText}>{t('providers.transferApply')}</Text>
        </Pressable>
        {result ? (
          <Text accessibilityRole="alert" style={styles.result}>{result}</Text>
        ) : null}
        {applyError ? (
          <Text accessibilityRole="alert" style={styles.error}>{applyError}</Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: {
    width: '100%',
    maxWidth: 820,
    alignSelf: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 40,
  },
  header: { alignItems: 'center', gap: 13 },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  title: { color: theme.colors.text, fontSize: 24, fontWeight: '700', flex: 1 },
  hint: { color: theme.colors.muted, fontSize: 13, lineHeight: 19 },
  card: {
    borderRadius: 13,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    padding: 14,
    gap: 10,
  },
  cardTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '600' },
  code: {
    color: theme.colors.muted,
    fontSize: 10,
    lineHeight: 15,
    maxHeight: 160,
  },
  muted: { color: theme.colors.muted, fontSize: 12, lineHeight: 18 },
  input: {
    minHeight: 88,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.background,
    color: theme.colors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 11,
  },
  apply: {
    alignSelf: 'flex-start',
    borderRadius: 10,
    backgroundColor: theme.colors.accent,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  applyText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  result: { color: theme.colors.muted, fontSize: 12, lineHeight: 18 },
  error: { color: theme.colors.danger, fontSize: 12, lineHeight: 18 },
  disabled: { opacity: 0.5 },
  focused: { borderColor: theme.colors.focus },
  pressed: { opacity: 0.75 },
});

import React, { useEffect, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  isSensitiveAddonConfigField,
  type AddonStateRecord,
} from '@moviestv/addons';
import { type Theme } from '@moviestv/ui';
import { useI18n } from '../i18n/useI18n';
import { useSwipeBack } from '../components/useSwipeBack';
import { safeProviderErrorMessage } from './providerError';
import { useAddons } from './useAddons';
import { useTheme, useThemeStyles } from '../theme/ThemeProvider';

export function ProviderConfigScreen({
  record,
  onBack,
  onConfigured,
}: {
  record: AddonStateRecord;
  onBack(): void;
  onConfigured(record: AddonStateRecord): void;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useTheme();
  const addons = useAddons();
  const { t, direction } = useI18n();
  const descriptor = record.descriptor;
  const [values, setValues] = useState<Record<string, string | boolean>>({ ...record.safeConfig });
  const [savedSecrets, setSavedSecrets] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operationGenerationRef = useRef(0);

  useEffect(() => () => {
    operationGenerationRef.current += 1;
  }, []);

  useEffect(() => {
    let active = true;
    if (!descriptor) return () => { active = false; };

    const secretFields = descriptor.configurationFields.filter(isSensitiveAddonConfigField);
    if (secretFields.length === 0) return () => { active = false; };

    void Promise.all(
      secretFields.map(async (field) => [
        field.key,
        await addons.hasSavedSecret(record.installed.addonId, field.key),
      ] as const),
    ).then((entries) => {
      if (active) setSavedSecrets(Object.fromEntries(entries));
    }).catch(() => {
      if (active) setSavedSecrets({});
    });

    return () => { active = false; };
  }, [addons, descriptor, record.installed.addonId]);

  // The configured link is the one thing a second device cannot receive through
  // sync (it can carry a debrid key). Showing it lets the user copy it across by
  // hand instead of regenerating it on the provider's website.
  const [runtimeLink, setRuntimeLink] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const read = addons.getRuntimeManifestUrl?.(record.installed.addonId);
    if (!read) return () => { active = false; };
    void read.then((url) => {
      if (active) setRuntimeLink(url);
    }).catch(() => {
      if (active) setRuntimeLink(null);
    });
    return () => { active = false; };
  }, [addons, record.installed.addonId]);

  const save = async () => {
    if (!descriptor || busy) return;
    const generation = ++operationGenerationRef.current;
    setBusy(true);
    setError(null);
    try {
      const configured = await addons.configure(
        record.installed.addonId,
        values,
      );
      if (generation !== operationGenerationRef.current) return;
      onConfigured(configured);
    } catch (cause) {
      if (generation !== operationGenerationRef.current) return;
      setError(safeProviderErrorMessage(
        cause,
        t('common.unavailable'),
      ));
    } finally {
      if (generation === operationGenerationRef.current) {
        setBusy(false);
      }
    }
  };

  const handleBack = () => {
    operationGenerationRef.current += 1;
    setBusy(false);
    onBack();
  };
  const swipeHandlers = useSwipeBack(handleBack);

  return (
    <ScrollView
      testID="provider-config-screen"
      {...swipeHandlers}
      style={styles.screen}
      contentContainerStyle={[styles.content, { direction }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.header, { flexDirection: direction === 'rtl' ? 'row-reverse' : 'row' }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          testID="provider-config-back"
          onPress={handleBack}
          style={({ focused, pressed }) => [
            styles.backButton,
            focused && styles.focused,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="chevron-back" size={24} color={theme.colors.text} />
        </Pressable>
        <Text style={[styles.title, { writingDirection: direction }]}>
          {descriptor?.name ?? t('common.provider')}
        </Text>
      </View>

      {runtimeLink ? (
        <View style={styles.linkCard} testID="provider-current-link">
          <Text style={[styles.linkLabel, { writingDirection: direction }]}>
            {t('providers.currentLinkTitle')}
          </Text>
          <Text selectable style={styles.linkValue}>{runtimeLink}</Text>
          <Text style={[styles.linkHint, { writingDirection: direction }]}>
            {t('providers.currentLinkHint')}
          </Text>
        </View>
      ) : null}

      {!descriptor ? (
        <View style={styles.errorCard}>
          <Text style={[styles.error, { writingDirection: direction }]}>
            {t('common.unavailable')}
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.fields}>
            {descriptor.configurationFields.map((field) => {
              const value = values[field.key];

              return (
                <View key={field.key} style={styles.field}>
                  <View style={styles.fieldHeading}>
                    <Text style={[styles.label, { writingDirection: direction }]}>
                      {field.label}{field.required ? ' *' : ''}
                    </Text>
                    {isSensitiveAddonConfigField(field) && savedSecrets[field.key] ? (
                      <View style={styles.savedBadge}>
                        <Text style={styles.saved}>{t('common.save')}</Text>
                      </View>
                    ) : null}
                  </View>

                  {field.type === 'boolean' ? (
                    <Pressable
                      accessibilityRole="switch"
                      accessibilityState={{
                        checked: Boolean(value),
                        disabled: busy,
                      }}
                      focusable={!busy}
                      disabled={busy}
                      testID={`provider-config-${field.key}`}
                      onPress={() => setValues((current) => ({
                        ...current,
                        [field.key]: !Boolean(current[field.key]),
                      }))}
                      style={({ focused, pressed }) => [
                        styles.toggle,
                        Boolean(value) && styles.toggleOn,
                        focused && styles.focused,
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={[styles.toggleKnob, Boolean(value) && styles.toggleKnobOn]} />
                    </Pressable>
                  ) : field.type === 'select' ? (
                    <View style={styles.options}>
                      {(field.options ?? []).map((option) => {
                        const selected = String(value ?? '') === option.value;
                        return (
                          <Pressable
                            key={option.value}
                            accessibilityRole="radio"
                            accessibilityState={{ selected, disabled: busy }}
                            focusable={!busy}
                            disabled={busy}
                            testID={`provider-config-${field.key}-option-${option.value}`}
                            onPress={() => setValues((current) => ({
                              ...current,
                              [field.key]: option.value,
                            }))}
                            style={({ focused, pressed }) => [
                              styles.option,
                              selected && styles.selectedOption,
                              focused && styles.focused,
                              pressed && styles.pressed,
                            ]}
                          >
                            <Text style={[styles.optionLabel, { writingDirection: direction }]}>
                              {selected ? '● ' : '○ '}{option.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : (
                    <TextInput
                      testID={`provider-config-${field.key}`}
                      value={String(value ?? '')}
                      onChangeText={(nextValue) => setValues((current) => ({
                        ...current,
                        [field.key]: nextValue,
                      }))}
                      secureTextEntry={isSensitiveAddonConfigField(field)}
                      editable={!busy}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType={field.type === 'url' ? 'url' : 'default'}
                      placeholder={field.placeholder ?? ''}
                      placeholderTextColor={theme.colors.muted}
                      style={[styles.input, { textAlign: direction === 'rtl' ? 'right' : 'left' }]}
                    />
                  )}
                </View>
              );
            })}
          </View>

          {error ? (
            <View style={styles.errorCard}>
              <Text accessibilityRole="alert" style={[styles.error, { writingDirection: direction }]}>
                {error}
              </Text>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            testID="provider-config-save"
            onPress={() => { void save(); }}
            style={({ focused, pressed }) => [
              styles.saveButton,
              busy && styles.disabled,
              focused && !busy && styles.focused,
              pressed && !busy && styles.pressed,
            ]}
          >
            <Text style={styles.saveText}>{busy ? t('common.loading') : t('common.save')}</Text>
          </Pressable>
        </>
      )}
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
    paddingHorizontal: '5%',
    paddingTop: 28,
    paddingBottom: 100,
  },
  header: { alignItems: 'center', gap: 13, marginBottom: 6 },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  backText: { color: theme.colors.text, fontSize: 27, fontWeight: '600' },
  title: {
    flex: 1,
    color: theme.colors.text,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  fields: { gap: 11 },
  field: {
    gap: 10,
    padding: 16,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
  },
  fieldHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  label: { color: theme.colors.text, fontSize: 14, fontWeight: '800' },
  savedBadge: { borderRadius: 999, backgroundColor: theme.colors.surfaceElevated, paddingHorizontal: 8, paddingVertical: 4 },
  saved: { color: theme.colors.muted, fontSize: 9, fontWeight: '900' },
  input: {
    minHeight: 50,
    paddingHorizontal: 13,
    color: theme.colors.text,
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    fontSize: 14,
  },
  toggle: {
    width: 49,
    height: 29,
    justifyContent: 'center',
    borderRadius: 999,
    paddingHorizontal: 3,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceElevated,
  },
  toggleOn: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  toggleKnob: { width: 21, height: 21, borderRadius: 999, backgroundColor: theme.colors.muted },
  toggleKnobOn: { alignSelf: 'flex-end', backgroundColor: '#ffffff' },
  options: { gap: 7 },
  option: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 13,
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
  },
  selectedOption: { borderColor: theme.colors.accent },
  optionLabel: { color: theme.colors.text, fontSize: 13, fontWeight: '700' },
  saveButton: {
    minHeight: 47,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#ffffff',
    paddingHorizontal: 18,
  },
  saveText: { color: '#09090b', fontSize: 13, fontWeight: '900' },
  linkCard: {
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'rgba(108,75,239,0.35)',
    backgroundColor: 'rgba(108,75,239,0.08)',
    padding: 14,
    gap: 6,
  },
  linkLabel: { color: theme.colors.text, fontSize: 13, fontWeight: '600' },
  linkValue: { color: theme.colors.muted, fontSize: 11, lineHeight: 17 },
  linkHint: { color: theme.colors.subtle, fontSize: 11, lineHeight: 16 },
  errorCard: {
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'rgba(255,95,104,0.35)',
    backgroundColor: 'rgba(255,95,104,0.08)',
    padding: 14,
  },
  error: { color: theme.colors.danger, fontSize: 12, lineHeight: 18 },
  focused: { borderColor: theme.colors.focus },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.72 },
});

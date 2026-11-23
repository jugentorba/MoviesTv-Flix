import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { type Theme } from '@moviestv/ui';
import { useAccount } from '../auth/useAccount';
import { useI18n } from '../i18n/useI18n';
import {
  createLiveTvGuideRuntime,
  notifyLiveTvGuideChanged,
} from './live-tv-guide-runtime';
import { validateAndSaveLiveTvGuide } from './live-tv-guide-setup';
import type { GuideConfigState } from './LiveTvGuideRepository';
import { useTheme, useThemeStyles } from '../theme/ThemeProvider';

const EMPTY_CONFIG: GuideConfigState = {
  configured: false,
  sourceRevision: 0,
  secure: false,
};

function copyFor(t: (key: string) => string) {
  return {
    back: t('liveTvGuide.back'),
    eyebrow: t('liveTvGuide.eyebrow'),
    title: t('liveTvGuide.title'),
    body: t('liveTvGuide.body'),
    label: t('liveTvGuide.label'),
    placeholder: t('liveTvGuide.placeholder'),
    securePlaceholder: t('liveTvGuide.securePlaceholder'),
    save: t('liveTvGuide.save'),
    remove: t('liveTvGuide.remove'),
    saved: t('liveTvGuide.saved'),
    removed: t('liveTvGuide.removed'),
    error: t('liveTvGuide.error'),
    loadError: t('liveTvGuide.loadError'),
    removeError: t('liveTvGuide.removeError'),
    publicStatus: t('liveTvGuide.publicStatus'),
    secureStatus: t('liveTvGuide.secureStatus'),
    note: t('liveTvGuide.note'),
  };
}

function ActionButton({
  label,
  onPress,
  disabled = false,
  danger = false,
  testID,
}: {
  label: string;
  onPress(): void;
  disabled?: boolean;
  danger?: boolean;
  testID?: string;
}) {
  const styles = useThemeStyles(createStyles);
  return (
    <Pressable
      focusable={!disabled}
      disabled={disabled}
      accessibilityRole="button"
      testID={testID}
      onPress={onPress}
      style={({ focused, pressed }) => [
        styles.button,
        danger && styles.dangerButton,
        disabled && styles.disabled,
        focused && !disabled && styles.focused,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, danger && styles.dangerText]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function LiveTvGuideSettingsScreen({
  onBack,
}: {
  onBack(): void;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useTheme();
  const { userId } = useAccount();
  const { t, direction } = useI18n();
  const copy = useMemo(() => copyFor(t), [t]);
  const guideRuntime = useMemo(
    () => createLiveTvGuideRuntime(userId),
    [userId],
  );
  const identityGenerationRef = useRef(1);
  const guideIdentityRef = useRef(userId);
  if (guideIdentityRef.current !== userId) {
    guideIdentityRef.current = userId;
    identityGenerationRef.current += 1;
  }
  const renderGeneration = identityGenerationRef.current;
  const liveTvGuideRepository = guideRuntime.repository;
  const liveTvGuideProvider = guideRuntime.provider;
  const [config, setConfig] = useState<GuideConfigState>(EMPTY_CONFIG);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setBusy(false);
    setConfig(EMPTY_CONFIG);
    setUrl('');
    setMessage(null);
    setError(null);

    void liveTvGuideRepository.loadConfig()
      .then((stored) => {
        if (!active) return;
        setConfig(stored);
        if (stored.configured && !stored.secure && stored.publicUrl) {
          setUrl(stored.publicUrl);
        }
      })
      .catch(() => {
        if (active) setError(copy.loadError);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [copy.loadError, liveTvGuideRepository]);

  const save = async () => {
    const generation = renderGeneration;
    if (generation !== identityGenerationRef.current) return;
    const value = url.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const next = await validateAndSaveLiveTvGuide(
        value,
        liveTvGuideProvider,
        liveTvGuideRepository,
      );
      if (generation !== identityGenerationRef.current) return;
      setConfig(next);
      notifyLiveTvGuideChanged();
      setMessage(copy.saved);
      if (next.secure) setUrl('');
    } catch {
      if (generation === identityGenerationRef.current) {
        setError(copy.error);
      }
    } finally {
      if (generation === identityGenerationRef.current) {
        setBusy(false);
      }
    }
  };

  const remove = async () => {
    const generation = renderGeneration;
    if (generation !== identityGenerationRef.current || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      await liveTvGuideRepository.removeConfig();
      if (generation !== identityGenerationRef.current) return;
      setConfig(EMPTY_CONFIG);
      setUrl('');
      notifyLiveTvGuideChanged();
      setMessage(copy.removed);
    } catch {
      if (generation === identityGenerationRef.current) {
        setError(copy.removeError);
      }
    } finally {
      if (generation === identityGenerationRef.current) {
        setBusy(false);
      }
    }
  };

  return (
    <ScrollView
      testID="live-tv-guide-settings"
      style={[styles.page, { direction }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <ActionButton
        label={'‹ ' + copy.back}
        onPress={onBack}
        testID="live-tv-guide-back"
      />

      <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
      <Text style={[styles.title, { writingDirection: direction }]}>
        {copy.title}
      </Text>
      <Text style={[styles.body, { writingDirection: direction }]}>
        {copy.body}
      </Text>

      <View style={styles.card}>
        <Text style={styles.label}>{copy.label}</Text>
        <TextInput
          testID="live-tv-guide-url"
          value={url}
          onChangeText={(value) => {
            setUrl(value);
            setMessage(null);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder={
            config.configured && config.secure
              ? copy.securePlaceholder
              : copy.placeholder
          }
          placeholderTextColor={theme.colors.muted}
          style={styles.input}
        />

        <View style={styles.actions}>
          <ActionButton
            label={copy.save}
            onPress={() => { void save(); }}
            disabled={busy || !url.trim()}
            testID="live-tv-guide-save"
          />
          {config.configured ? (
            <ActionButton
              label={copy.remove}
              onPress={() => { void remove(); }}
              disabled={busy}
              danger
              testID="live-tv-guide-remove"
            />
          ) : null}
          {busy ? <ActivityIndicator color={theme.colors.accent} /> : null}
        </View>

        {loading ? (
          <ActivityIndicator color={theme.colors.accent} style={styles.loader} />
        ) : null}

        {!loading && config.configured ? (
          <Text style={styles.status}>
            {config.secure ? copy.secureStatus : copy.publicStatus}
          </Text>
        ) : null}

        {message ? <Text style={styles.success}>{message}</Text> : null}
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
      </View>

      <Text style={[styles.note, { writingDirection: direction }]}>
        {copy.note}
      </Text>
    </ScrollView>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.colors.background },
  content: {
    width: '100%',
    maxWidth: 920,
    alignSelf: 'center',
    paddingHorizontal: '6%',
    paddingTop: '5%',
    paddingBottom: 100,
  },
  eyebrow: {
    color: theme.colors.accentSoft,
    fontSize: 13,
    letterSpacing: 2,
    fontWeight: '900',
    marginTop: theme.spacing.xl,
    marginBottom: theme.spacing.md,
  },
  title: {
    color: theme.colors.text,
    fontSize: 36,
    lineHeight: 42,
    fontWeight: '900',
  },
  body: {
    color: theme.colors.muted,
    fontSize: 16,
    lineHeight: 24,
    maxWidth: 760,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.xl,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
  },
  label: {
    color: theme.colors.text,
    fontWeight: '800',
    marginBottom: theme.spacing.sm,
  },
  input: {
    backgroundColor: theme.colors.surfaceElevated,
    color: theme.colors.text,
    borderWidth: 2,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 13,
    fontSize: 15,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  button: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 10,
  },
  dangerButton: { borderColor: '#61252a' },
  buttonText: { color: theme.colors.text, fontWeight: '800' },
  dangerText: { color: theme.colors.danger },
  focused: {
    borderColor: theme.colors.focus,
    transform: [{ scale: 1.03 }],
  },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.7 },
  loader: { marginTop: theme.spacing.md },
  status: {
    color: theme.colors.muted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: theme.spacing.md,
  },
  success: {
    color: theme.colors.accentSoft,
    fontWeight: '800',
    marginTop: theme.spacing.md,
  },
  error: {
    color: theme.colors.danger,
    fontWeight: '700',
    marginTop: theme.spacing.md,
  },
  note: {
    color: theme.colors.muted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: theme.spacing.lg,
  },
});

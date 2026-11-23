import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
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
import type { M3uPlaylistRecord } from './M3uLiveTvAdapter';
import {
  MAX_M3U_PLAYLISTS,
  MAX_M3U_PLAYLIST_NAME_LENGTH,
} from './M3uPlaylistStore';
import { m3uPlaylistStoreFor } from './m3u-playlist-runtime';
import { useTheme, useThemeStyles } from '../theme/ThemeProvider';

/**
 * Never show a stored playlist URL: the path normally carries the provider's
 * credentials. The host alone is enough to tell two playlists apart.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function copyFor(t: (key: string, params?: Record<string, string | number>) => string) {
  return {
    back: t('liveTvPlaylists.back'),
    eyebrow: t('liveTvPlaylists.eyebrow'),
    title: t('liveTvPlaylists.title'),
    body: t('liveTvPlaylists.body'),
    label: t('liveTvPlaylists.label'),
    namePlaceholder: t('liveTvPlaylists.namePlaceholder'),
    urlLabel: t('liveTvPlaylists.urlLabel'),
    urlPlaceholder: t('liveTvPlaylists.urlPlaceholder'),
    add: t('liveTvPlaylists.add'),
    empty: t('liveTvPlaylists.empty'),
    enable: t('liveTvPlaylists.enable'),
    disable: t('liveTvPlaylists.disable'),
    statusOn: t('liveTvPlaylists.statusOn'),
    statusOff: t('liveTvPlaylists.statusOff'),
    remove: t('liveTvPlaylists.remove'),
    added: t('liveTvPlaylists.added'),
    removed: t('liveTvPlaylists.removed'),
    invalidName: t('liveTvPlaylists.invalidName'),
    invalidUrl: t('liveTvPlaylists.invalidUrl'),
    loadError: t('liveTvPlaylists.loadError'),
    updateError: t('liveTvPlaylists.updateError'),
    tooMany: t('liveTvPlaylists.tooMany', { count: MAX_M3U_PLAYLISTS }),
    note: t(
      Platform.OS === 'web'
        ? 'liveTvPlaylists.note.web'
        : 'liveTvPlaylists.note.native',
    ),
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

export function LiveTvPlaylistSettingsScreen({
  onBack,
}: {
  onBack(): void;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useTheme();
  const { userId } = useAccount();
  const { t, direction } = useI18n();
  const copy = useMemo(() => copyFor(t), [t]);
  const store = useMemo(() => m3uPlaylistStoreFor(userId), [userId]);
  const identityGenerationRef = useRef(1);
  const identityRef = useRef(userId);
  if (identityRef.current !== userId) {
    identityRef.current = userId;
    identityGenerationRef.current += 1;
  }
  const renderGeneration = identityGenerationRef.current;

  const [records, setRecords] = useState<M3uPlaylistRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const generation = renderGeneration;
    try {
      const next = await store.list();
      if (generation !== identityGenerationRef.current) return;
      setRecords(next);
    } catch {
      if (generation === identityGenerationRef.current) {
        setError(copy.loadError);
      }
    }
  }, [copy.loadError, renderGeneration, store]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setRecords([]);
    setMessage(null);
    setError(null);
    void store.list()
      .then((next) => {
        if (active) setRecords(next);
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
  }, [copy.loadError, store]);

  const add = async () => {
    const generation = renderGeneration;
    if (generation !== identityGenerationRef.current || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await store.add({ name, url });
      if (generation !== identityGenerationRef.current) return;
      if (!result.ok) {
        setError(
          result.reason === 'invalid-name'
            ? copy.invalidName
            : result.reason === 'invalid-url'
              ? copy.invalidUrl
              : copy.tooMany,
        );
        return;
      }
      setName('');
      setUrl('');
      setMessage(copy.added);
      await reload();
    } catch {
      if (generation === identityGenerationRef.current) {
        setError(copy.invalidUrl);
      }
    } finally {
      if (generation === identityGenerationRef.current) setBusy(false);
    }
  };

  const toggle = async (record: M3uPlaylistRecord) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await store.setEnabled(record.id, !record.enabled);
      await reload();
    } catch {
      setError(copy.updateError);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (record: M3uPlaylistRecord) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await store.remove(record.id);
      setMessage(copy.removed);
      await reload();
    } catch {
      setError(copy.updateError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      testID="live-tv-playlist-settings"
      style={[styles.page, { direction }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <ActionButton
        label={'‹ ' + copy.back}
        onPress={onBack}
        testID="live-tv-playlist-back"
      />

      <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
      <Text style={[styles.title, { writingDirection: direction }]}>
        {copy.title}
      </Text>
      <Text style={[styles.body, { writingDirection: direction }]}>
        {copy.body}
      </Text>

      <View style={styles.card}>
        {loading ? (
          <ActivityIndicator color={theme.colors.accent} />
        ) : records.length === 0 ? (
          <Text style={styles.status}>{copy.empty}</Text>
        ) : (
          records.map((record) => (
            <View key={record.id} style={styles.row} testID={`live-tv-playlist-${record.id}`}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{record.name}</Text>
                <Text style={styles.rowDetail}>{hostOf(record.url)}</Text>
                <Text style={styles.rowDetail}>
                  {record.enabled ? copy.statusOn : copy.statusOff}
                </Text>
              </View>
              <View style={styles.rowActions}>
                <ActionButton
                  label={record.enabled ? copy.disable : copy.enable}
                  onPress={() => { void toggle(record); }}
                  disabled={busy}
                  testID={`live-tv-playlist-toggle-${record.id}`}
                />
                <ActionButton
                  label={copy.remove}
                  onPress={() => { void remove(record); }}
                  disabled={busy}
                  danger
                  testID={`live-tv-playlist-remove-${record.id}`}
                />
              </View>
            </View>
          ))
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>{copy.label}</Text>
        <TextInput
          testID="live-tv-playlist-name"
          value={name}
          onChangeText={(value) => {
            setName(value.slice(0, MAX_M3U_PLAYLIST_NAME_LENGTH));
            setMessage(null);
          }}
          autoCorrect={false}
          placeholder={copy.namePlaceholder}
          placeholderTextColor={theme.colors.muted}
          style={styles.input}
        />

        <Text style={[styles.label, styles.urlLabel]}>{copy.urlLabel}</Text>
        <TextInput
          testID="live-tv-playlist-url"
          value={url}
          onChangeText={(value) => {
            setUrl(value);
            setMessage(null);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder={copy.urlPlaceholder}
          placeholderTextColor={theme.colors.muted}
          style={styles.input}
        />

        <View style={styles.actions}>
          <ActionButton
            label={copy.add}
            onPress={() => { void add(); }}
            disabled={busy || !name.trim() || !url.trim()}
            testID="live-tv-playlist-add"
          />
          {busy ? <ActivityIndicator color={theme.colors.accent} /> : null}
        </View>

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
    marginBottom: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  rowText: { flexShrink: 1, gap: 2 },
  rowTitle: { color: theme.colors.text, fontWeight: '800', fontSize: 16 },
  rowDetail: { color: theme.colors.muted, fontSize: 13 },
  rowActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  label: {
    color: theme.colors.text,
    fontWeight: '800',
    marginBottom: theme.spacing.sm,
  },
  urlLabel: { marginTop: theme.spacing.md },
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
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 12,
  },
  dangerButton: { borderColor: '#61252a' },
  buttonText: { color: theme.colors.text, fontWeight: '800' },
  dangerText: { color: theme.colors.danger },
  focused: { borderColor: theme.colors.accent, borderWidth: 2 },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
  status: { color: theme.colors.muted, fontSize: 14 },
  success: { color: theme.colors.accentSoft, fontWeight: '700', marginTop: theme.spacing.sm },
  error: { color: theme.colors.danger, fontWeight: '700', marginTop: theme.spacing.sm },
  note: { color: theme.colors.muted, fontSize: 13, lineHeight: 20 },
});

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { AddonDescriptor, AddonStateRecord } from '@moviestv/addons';
import { type Theme } from '@moviestv/ui';
import { useI18n } from '../i18n/useI18n';
import { useSwipeBack } from '../components/useSwipeBack';
import type { InspectedAddon } from './AddonInstallationService';
import {
  isProviderNetworkError,
  safeProviderErrorMessage,
} from './providerError';
import { useAddons } from './useAddons';
import { useTheme, useThemeStyles } from '../theme/ThemeProvider';

export type ProviderKind = 'catalog' | 'stream' | 'live-tv';

const NUVIO_CATALOG_ADDON_ID = 'com.nuvio.tmdb.catalogs';

function initialInstallConfig(
  descriptor: AddonDescriptor,
  locale: string,
  replacing: boolean,
): Record<string, string> {
  if (replacing || descriptor.id !== NUVIO_CATALOG_ADDON_ID) {
    return {};
  }

  const language = locale.toLowerCase().split('-')[0];
  const profile = language === 'fr'
    ? { language: 'fr-FR', region: 'FR' }
    : language === 'de'
      ? { language: 'de-DE', region: 'DE' }
      : language === 'sq'
        ? { language: 'sq-AL', region: 'AL' }
        : { language: 'en-US', region: 'US' };
  const declaredKeys = new Set(
    descriptor.configurationFields.map((field) => field.key),
  );

  return Object.fromEntries(
    Object.entries(profile).filter(([key]) => declaredKeys.has(key)),
  );
}

function wrongKindMessage(
  t: (key: string, params?: Record<string, string | number>) => string,
  kind: ProviderKind,
  kindLabel: string,
): string {
  if (kind === 'catalog') return t('addProvider.wrongKind.catalog');
  if (kind === 'live-tv') {
    return t('addProvider.wrongKind.liveTv', { label: kindLabel });
  }
  return t('addProvider.wrongKind.streams', { label: kindLabel });
}

function supportsKind(descriptor: AddonDescriptor, kind: ProviderKind): boolean {
  const supportsMoviesOrSeries = descriptor.supportedMediaKinds.some(
    (mediaKind) => mediaKind === 'movie' || mediaKind === 'series',
  );
  if (kind === 'live-tv') return descriptor.capabilities.includes('live-tv');
  if (kind === 'catalog') {
    return supportsMoviesOrSeries && descriptor.capabilities.includes('catalog');
  }
  return supportsMoviesOrSeries && (
    descriptor.capabilities.includes('stream')
    || descriptor.capabilities.includes('subtitle')
  );
}

function copyFor(
  t: (key: string) => string,
  kind: ProviderKind,
  replacing: boolean,
) {
  return {
    catalogLabel: t('addProvider.catalogLabel'),
    title: t(
      replacing
        ? 'addProvider.title.replace'
        : kind === 'catalog'
          ? 'addProvider.title.catalog'
          : kind === 'live-tv'
            ? 'addProvider.title.liveTv'
            : 'addProvider.title.streams',
    ),
    subtitle: t('addProvider.subtitle'),
    manifestLabel: t('addProvider.manifestLabel'),
    manifestPlaceholder: t('addProvider.manifestPlaceholder'),
    inspect: t('addProvider.inspect'),
    install: t('addProvider.install'),
    capabilities: t('addProvider.capabilities'),
    wrongProvider: t('addProvider.wrongProvider'),
    browserNetworkError: t('addProvider.browserNetworkError'),
  };
}

export function AddProviderScreen({
  kind,
  onBack,
  onInstalled,
  expectedAddonId,
}: {
  kind: ProviderKind;
  onBack(): void;
  onInstalled(record: AddonStateRecord): void;
  expectedAddonId?: string;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useTheme();
  const addons = useAddons();
  const { t, direction, locale } = useI18n();
  const [url, setUrl] = useState('');
  const [inspected, setInspected] = useState<InspectedAddon | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operationGenerationRef = useRef(0);

  useEffect(() => () => {
    operationGenerationRef.current += 1;
  }, []);
  const copy = copyFor(t, kind, Boolean(expectedAddonId));
  const kindLabel = useMemo(
    () => kind === 'live-tv'
      ? t('nav.liveTv')
      : kind === 'catalog'
        ? copy.catalogLabel
        : `${t('nav.movies')} / ${t('nav.series')}`,
    [copy.catalogLabel, kind, t],
  );

  const inspect = async () => {
    const input = url.trim();
    if (!input || busy) return;
    const generation = ++operationGenerationRef.current;
    setBusy(true);
    setError(null);
    setInspected(null);
    try {
      const result = await addons.inspectManifest(input, 'manual');
      if (generation !== operationGenerationRef.current) return;
      if (!supportsKind(result.descriptor, kind)) {
        setError(wrongKindMessage(t, kind, kindLabel));
        return;
      }
      if (expectedAddonId && result.descriptor.id !== expectedAddonId) {
        setError(copy.wrongProvider);
        return;
      }
      setInspected(result);
    } catch (cause) {
      if (generation !== operationGenerationRef.current) return;
      if (Platform.OS === 'web' && isProviderNetworkError(cause)) {
        setError(copy.browserNetworkError);
        return;
      }
      const message = safeProviderErrorMessage(
        cause,
        t('common.unavailable'),
      );
      setError(message);
    } finally {
      if (generation === operationGenerationRef.current) {
        setBusy(false);
      }
    }
  };

  const install = async () => {
    if (!inspected || busy) return;
    const generation = ++operationGenerationRef.current;
    setBusy(true);
    setError(null);
    try {
      const installed = await addons.install(
        inspected,
        initialInstallConfig(
          inspected.descriptor,
          locale,
          Boolean(expectedAddonId),
        ),
      );
      if (generation !== operationGenerationRef.current) return;
      onInstalled(installed);
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
      testID={`add-provider-screen-${kind}`}
      {...swipeHandlers}
      style={styles.screen}
      contentContainerStyle={[styles.content, { direction }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.header, { flexDirection: direction === 'rtl' ? 'row-reverse' : 'row' }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          testID="provider-add-back"
          onPress={handleBack}
          style={({ focused, pressed }) => [styles.backButton, focused && styles.focused, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={24} color={theme.colors.text} />
        </Pressable>
        <View style={styles.headingCopy}>
          <Text style={[styles.title, { writingDirection: direction }]}>{copy.title}</Text>
          <Text style={[styles.subtitle, { writingDirection: direction }]}>{copy.subtitle}</Text>
        </View>
      </View>

      <View style={styles.formCard}>
        <Text style={styles.label}>{copy.manifestLabel}</Text>
        <TextInput
          testID="provider-manifest-url"
          value={url}
          onChangeText={(value) => {
            operationGenerationRef.current += 1;
            setUrl(value);
            setInspected(null);
            setError(null);
            setBusy(false);
          }}
          editable={!(busy && Boolean(inspected))}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder={copy.manifestPlaceholder}
          placeholderTextColor={theme.colors.muted}
          style={[styles.input, { textAlign: direction === 'rtl' ? 'right' : 'left' }]}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: busy || !url.trim() }}
          disabled={busy || !url.trim()}
          testID="provider-inspect"
          onPress={() => { void inspect(); }}
          style={({ focused, pressed }) => [
            styles.primaryButton,
            (busy || !url.trim()) && styles.disabled,
            focused && !busy && Boolean(url.trim()) && styles.focused,
            pressed && !busy && Boolean(url.trim()) && styles.pressed,
          ]}
        >
          <Text style={styles.primaryButtonText}>{busy ? t('common.loading') : copy.inspect}</Text>
        </Pressable>
      </View>

      {error ? (
        <View style={styles.errorCard}>
          <Text accessibilityRole="alert" style={[styles.error, { writingDirection: direction }]}>{error}</Text>
        </View>
      ) : null}

      {inspected ? (
        <View style={styles.summary}>
          <View style={styles.summaryTop}>
            <View style={styles.providerMark}>
              <Text style={styles.providerMarkText}>{inspected.descriptor.name.slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={styles.providerCopy}>
              <Text style={[styles.providerName, { writingDirection: direction }]}>
                {inspected.descriptor.name}
              </Text>
              <Text style={[styles.meta, { writingDirection: direction }]}>
                v{inspected.descriptor.version} · {inspected.descriptor.sourceType}
              </Text>
            </View>
          </View>

          {inspected.descriptor.description ? (
            <Text style={[styles.description, { writingDirection: direction }]}>
              {inspected.descriptor.description}
            </Text>
          ) : null}

          <Text style={styles.capabilityHeading}>{copy.capabilities}</Text>
          <View style={styles.badges}>
            {inspected.descriptor.capabilities.map((capability) => (
              <View key={capability} style={styles.badge}>
                <Text style={styles.badgeText}>{capability}</Text>
              </View>
            ))}
            {inspected.descriptor.supportedMediaKinds.map((mediaKind) => (
              <View key={mediaKind} style={styles.badge}>
                <Text style={styles.badgeText}>{mediaKind}</Text>
              </View>
            ))}
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            testID="provider-confirm-install"
            onPress={() => { void install(); }}
            style={({ focused, pressed }) => [
              styles.installButton,
              busy && styles.disabled,
              focused && !busy && styles.focused,
              pressed && !busy && styles.pressed,
            ]}
          >
            <Text style={styles.installText}>{busy ? t('common.loading') : copy.install}</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: {
    width: '100%',
    maxWidth: 800,
    alignSelf: 'center',
    paddingHorizontal: '5%',
    paddingTop: 28,
    paddingBottom: 100,
    gap: 18,
  },
  header: { alignItems: 'center', gap: 13, marginBottom: 4 },
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
  headingCopy: { flex: 1 },
  title: { color: theme.colors.text, fontSize: 28, lineHeight: 34, fontWeight: '900', letterSpacing: -0.6 },
  subtitle: { color: theme.colors.muted, fontSize: 12, lineHeight: 18, marginTop: 3 },
  formCard: {
    gap: 11,
    padding: 17,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  label: { color: theme.colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  input: {
    minHeight: 54,
    paddingHorizontal: 14,
    color: theme.colors.text,
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 11,
    fontSize: 14,
  },
  primaryButton: {
    minHeight: 45,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
  },
  primaryButtonText: { color: '#09090b', fontSize: 12, fontWeight: '900' },
  errorCard: {
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'rgba(255,95,104,0.35)',
    backgroundColor: 'rgba(255,95,104,0.08)',
    padding: 14,
  },
  error: { color: theme.colors.danger, fontSize: 12, lineHeight: 18 },
  summary: {
    gap: 13,
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  providerMark: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: theme.colors.surfaceElevated,
  },
  providerMarkText: { color: theme.colors.accentSoft, fontSize: 19, fontWeight: '900' },
  providerCopy: { flex: 1 },
  providerName: { color: theme.colors.text, fontSize: 18, fontWeight: '900' },
  description: { color: theme.colors.muted, fontSize: 13, lineHeight: 19 },
  meta: { color: theme.colors.muted, fontSize: 10, marginTop: 3 },
  capabilityHeading: { color: theme.colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1.1, textTransform: 'uppercase' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: { borderRadius: 999, backgroundColor: theme.colors.surfaceElevated, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { color: theme.colors.muted, fontSize: 9, fontWeight: '900' },
  installButton: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: theme.colors.accent,
  },
  installText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
  focused: { borderColor: theme.colors.focus },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.72 },
});

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { BackHandler, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { AddonStateRecord } from '@moviestv/addons';
import { type Theme, fontFamily } from '@moviestv/ui';
import { useI18n } from '../i18n/useI18n';
import { AddProviderScreen, type ProviderKind } from './AddProviderScreen';
import { ProviderConfigScreen } from './ProviderConfigScreen';
import { ProviderTransferScreen } from './ProviderTransferScreen';
import { useAddons } from './useAddons';
import { useWebTvBackHandler } from '../web/tvRemoteNavigation';
import { useSwipeBack } from '../components/useSwipeBack';
import { QuickstartAddons } from './AddonQuickstart';
import { safeProviderErrorMessage } from './providerError';
import { useTheme, useThemeStyles } from '../theme/ThemeProvider';

function recordCapabilities(record: AddonStateRecord) {
  return record.descriptor?.capabilities ?? record.syncIdentity?.capabilities ?? [];
}

function recordMediaKinds(record: AddonStateRecord) {
  return record.descriptor?.supportedMediaKinds ?? record.syncIdentity?.supportedMediaKinds ?? [];
}

function belongsToKind(record: AddonStateRecord, kind: ProviderKind): boolean {
  const capabilities = recordCapabilities(record);
  if (kind === 'live-tv') return capabilities.includes('live-tv');
  if (kind === 'catalog') return capabilities.includes('catalog');
  return capabilities.includes('stream') || capabilities.includes('subtitle');
}

function localCopy(t: (key: string) => string, kind: ProviderKind) {
  return {
    catalogTitle: t('providers.catalogTitle'),
    subtitle: t(
      kind === 'catalog'
        ? 'providers.subtitle.catalog'
        : kind === 'live-tv'
          ? 'providers.subtitle.liveTv'
          : 'providers.subtitle.streams',
    ),
    empty: t(
      kind === 'catalog'
        ? 'providers.empty.catalog'
        : kind === 'live-tv'
          ? 'providers.empty.liveTv'
          : 'providers.empty.streams',
    ),
    catalog: t('providers.catalog'),
    streams: t('providers.streams'),
    enabled: t('providers.enabled'),
    disabled: t('providers.disabled'),
    replaceUrl: t('providers.replaceUrl'),
    finishSetup: t('providers.finishSetup'),
    setupRequired: t('providers.setupRequired'),
    setupRequiredDetail: t(
      Platform.OS === 'web'
        ? 'providers.setupRequiredDetail.web'
        : 'providers.setupRequiredDetail.native',
    ),
  };
}

function Badge({ children, accent = false }: { children: React.ReactNode; accent?: boolean }) {
  const styles = useThemeStyles(createStyles);
  return (
    <View style={[styles.badge, accent && styles.badgeAccent]}>
      <Text style={[styles.badgeText, accent && styles.badgeTextAccent]}>{children}</Text>
    </View>
  );
}

export function ProvidersScreen({
  kind = 'stream',
  onBack,
}: {
  kind?: ProviderKind;
  onBack(): void;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useTheme();
  const { t, direction } = useI18n();
  const { installed, ready, error, setEnabled, move, remove } = useAddons();
  const [adding, setAdding] = useState(false);
  const [configuring, setConfiguring] = useState<AddonStateRecord | null>(null);
  const [replacing, setReplacing] = useState<AddonStateRecord | null>(null);
  const [transferring, setTransferring] = useState(false);
  // Declared with the other hooks: the setup screen is an early return, so a
  // hook placed below it would change the hook count between renders.
  const swipeHandlers = useSwipeBack(onBack);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const mutationGenerationRef = useRef(0);

  const runMutation = useCallback((operation: () => Promise<unknown>) => {
    const generation = ++mutationGenerationRef.current;
    setMutationError(null);

    let pending: Promise<unknown>;
    try {
      pending = operation();
    } catch (cause) {
      if (generation === mutationGenerationRef.current) {
        setMutationError(safeProviderErrorMessage(
          cause,
          t('common.unavailable'),
        ));
      }
      return;
    }

    void pending
      .then(() => {
        if (generation === mutationGenerationRef.current) {
          setMutationError(null);
        }
      })
      .catch((cause) => {
        if (generation !== mutationGenerationRef.current) return;
        setMutationError(safeProviderErrorMessage(
          cause,
          t('common.unavailable'),
        ));
      });
  }, [t]);

  useEffect(() => {
    mutationGenerationRef.current += 1;
    setMutationError(null);
  }, [kind]);

  useEffect(() => () => {
    mutationGenerationRef.current += 1;
  }, []);

  const handleNestedBack = useCallback(() => {
    if (transferring) {
      setTransferring(false);
      return true;
    }
    if (configuring) {
      setConfiguring(null);
      return true;
    }
    if (replacing) {
      setReplacing(null);
      return true;
    }
    if (adding) {
      setAdding(false);
      return true;
    }
    return false;
  }, [adding, configuring, replacing, transferring]);

  const nestedOpen = Boolean(adding || configuring || replacing || transferring);

  useWebTvBackHandler(
    nestedOpen,
    handleNestedBack,
  );

  useEffect(() => {
    if (!Platform.isTV || !nestedOpen) return undefined;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      handleNestedBack,
    );
    return () => subscription.remove();
  }, [handleNestedBack, nestedOpen]);

  const visibleProviders = useMemo(
    () => installed.filter((record) => belongsToKind(record, kind)),
    [installed, kind],
  );
  const copy = localCopy(t, kind);
  const kindLabel = kind === 'live-tv'
    ? t('nav.liveTv')
    : kind === 'catalog'
      ? copy.catalogTitle
      : `${t('nav.movies')} / ${t('nav.series')}`;

  if (transferring) {
    return <ProviderTransferScreen onBack={() => setTransferring(false)} />;
  }

  if (configuring) {
    return (
      <ProviderConfigScreen
        record={configuring}
        onBack={() => setConfiguring(null)}
        onConfigured={() => setConfiguring(null)}
      />
    );
  }

  if (replacing) {
    return (
      <AddProviderScreen
        kind={kind}
        expectedAddonId={replacing.installed.addonId}
        onBack={() => setReplacing(null)}
        onInstalled={(record) => {
          setReplacing(null);
          if (
            record.installed.setupIncomplete
            || Boolean(record.descriptor?.configurationFields.length)
          ) {
            setConfiguring(record);
          }
        }}
      />
    );
  }

  if (adding) {
    return (
      <AddProviderScreen
        kind={kind}
        onBack={() => setAdding(false)}
        onInstalled={(record) => {
          setAdding(false);
          if (
            record.installed.setupIncomplete
            || Boolean(record.descriptor?.configurationFields.length)
          ) {
            setConfiguring(record);
          }
        }}
      />
    );
  }

  const setupNeededCount = visibleProviders.filter(
    (record) => record.installed.setupIncomplete,
  ).length;

  return (
    <ScrollView
      testID="providers-screen"
      {...swipeHandlers}
      style={styles.screen}
      contentContainerStyle={[styles.content, { direction }]}
    >
      <View testID={`providers-kind-${kind}`} />
      <View style={[styles.header, { flexDirection: direction === 'rtl' ? 'row-reverse' : 'row' }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          testID="providers-back"
          onPress={onBack}
          style={({ focused, pressed }) => [
            styles.headerButton,
            focused && styles.focused,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="chevron-back" size={24} color={theme.colors.text} />
        </Pressable>
        <View style={styles.headingCopy}>
          <Text style={[styles.title, { writingDirection: direction }]}>{kindLabel}</Text>
          <Text style={[styles.subtitle, { writingDirection: direction }]}>{copy.subtitle}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('providers.transferTitle')}
          testID="provider-transfer"
          onPress={() => setTransferring(true)}
          style={({ focused, pressed }) => [
            styles.headerButton,
            focused && styles.focused,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="swap-horizontal" size={22} color={theme.colors.text} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`+ ${kindLabel}`}
          testID="provider-add"
          onPress={() => setAdding(true)}
          style={({ focused, pressed }) => [
            styles.addButton,
            focused && styles.focused,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="add" size={22} color="#09090b" />
        </Pressable>
      </View>

      {mutationError ? (
        <Text
          accessibilityRole="alert"
          testID="provider-mutation-error"
          style={styles.error}
        >
          {mutationError}
        </Text>
      ) : null}

      {!ready ? (
        <View style={styles.stateCard}>
          <Text style={styles.status}>{t('common.loading')}</Text>
        </View>
      ) : error ? (
        <View style={styles.stateCard}>
          <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
        </View>
      ) : visibleProviders.length === 0 ? (
        <View style={styles.stateCard}>
          <Text style={styles.status}>{copy.empty}</Text>
        </View>
      ) : (
        <>
        <QuickstartAddons kind={kind} />
        {setupNeededCount > 0 ? (
          <View testID="providers-setup-banner" style={styles.setupBanner}>
            <Ionicons name="cloud-done-outline" size={16} color={theme.colors.accentSoft} />
            <Text style={styles.setupBannerText}>
              {t('providers.syncedBanner', { count: setupNeededCount })}
            </Text>
          </View>
        ) : null}
        <View style={styles.list}>
          {visibleProviders.map((record, index) => {
            const addonId = record.installed.addonId;
            const enabled = record.installed.enabled;
            const first = index === 0;
            const last = index === visibleProviders.length - 1;
            const capabilities = recordCapabilities(record);
            const mediaKinds = recordMediaKinds(record);
            const configurable = Boolean(record.descriptor?.configurationFields.length);
            const movieCapable = mediaKinds.includes('movie');
            const seriesCapable = mediaKinds.includes('series');
            const liveTvCapable = capabilities.includes('live-tv');
            const catalogCapable = capabilities.includes('catalog');
            const streamCapable = capabilities.includes('stream');
            const subtitleCapable = capabilities.includes('subtitle');
            const configurableEndpoint = Boolean(
              record.descriptor?.configurable
              ?? record.syncIdentity?.configurable,
            );
            const needsManifest = Boolean(
              record.installed.setupIncomplete
              && !record.installed.manifestUrl
              && !record.descriptor?.manifestUrl,
            );

            return (
              <View
                key={addonId}
                style={[
                  styles.providerRow,
                  record.installed.setupIncomplete && styles.providerRowAttention,
                ]}
              >
                <View style={[styles.providerHeader, { flexDirection: direction === 'rtl' ? 'row-reverse' : 'row' }]}>
                  <View style={styles.providerIdentity}>
                    <Text style={[styles.providerName, { writingDirection: direction }]}>
                      {record.descriptor?.name ?? record.syncIdentity?.name ?? addonId}
                    </Text>
                    <Text numberOfLines={1} style={styles.providerId}>{addonId}</Text>
                    {record.installed.setupIncomplete ? (
                      <Text
                        testID={`provider-setup-detail-${addonId}`}
                        style={[styles.setupDetail, { writingDirection: direction }]}
                      >
                        {copy.setupRequiredDetail}
                      </Text>
                    ) : null}
                    <View style={styles.capabilities}>
                      <Badge accent={enabled}>{enabled ? copy.enabled : copy.disabled}</Badge>
                      {record.installed.setupIncomplete ? (
                        <Badge>{copy.setupRequired}</Badge>
                      ) : null}
                      {kind === 'catalog' && catalogCapable ? <Badge>{copy.catalog}</Badge> : null}
                      {kind === 'stream' && streamCapable ? <Badge>{copy.streams}</Badge> : null}
                      {kind === 'stream' && subtitleCapable ? <Badge>{t('playback.subtitles')}</Badge> : null}
                      {kind !== 'live-tv' && movieCapable ? <Badge>{t('common.movie')}</Badge> : null}
                      {kind !== 'live-tv' && seriesCapable ? <Badge>{t('common.series')}</Badge> : null}
                      {kind === 'live-tv' && liveTvCapable ? (
                        <View testID={`provider-capability-live-tv-${addonId}`}>
                          <Badge>{t('liveTv.title')}</Badge>
                        </View>
                      ) : null}
                    </View>
                  </View>

                  <Pressable
                    accessibilityRole="switch"
                    accessibilityState={{
                      checked: enabled,
                      disabled: record.installed.setupIncomplete,
                    }}
                    accessibilityLabel={record.installed.setupIncomplete ? copy.setupRequired : undefined}
                    disabled={record.installed.setupIncomplete}
                    testID={`provider-toggle-${addonId}`}
                    onPress={() => runMutation(() => setEnabled(addonId, !enabled))}
                    style={({ focused, pressed }) => [
                      styles.toggleButton,
                      enabled && styles.toggleButtonOn,
                      record.installed.setupIncomplete && styles.disabled,
                      focused && !record.installed.setupIncomplete && styles.focused,
                      pressed && !record.installed.setupIncomplete && styles.pressed,
                    ]}
                  >
                    <View style={[styles.toggleKnob, enabled && styles.toggleKnobOn]} />
                  </Pressable>
                </View>

                <View style={[styles.controls, { flexDirection: direction === 'rtl' ? 'row-reverse' : 'row' }]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('settings.moveUp')}
                    accessibilityState={{ disabled: first }}
                    disabled={first}
                    testID={`provider-move-up-${addonId}`}
                    onPress={() => runMutation(() => move(addonId, 'up'))}
                    style={({ focused, pressed }) => [
                      styles.controlButton,
                      first && styles.disabled,
                      focused && !first && styles.focused,
                      pressed && !first && styles.pressed,
                    ]}
                  >
                    <Ionicons name="arrow-up" size={12} color={theme.colors.text} />
                    <Text style={styles.controlLabel}>{t('settings.moveUp')}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('settings.moveDown')}
                    accessibilityState={{ disabled: last }}
                    disabled={last}
                    testID={`provider-move-down-${addonId}`}
                    onPress={() => runMutation(() => move(addonId, 'down'))}
                    style={({ focused, pressed }) => [
                      styles.controlButton,
                      last && styles.disabled,
                      focused && !last && styles.focused,
                      pressed && !last && styles.pressed,
                    ]}
                  >
                    <Ionicons name="arrow-down" size={12} color={theme.colors.text} />
                    <Text style={styles.controlLabel}>{t('settings.moveDown')}</Text>
                  </Pressable>
                  {configurable ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('common.details')}
                      testID={`provider-configure-${addonId}`}
                      onPress={() => setConfiguring(record)}
                      style={({ focused, pressed }) => [
                        styles.controlButton,
                        focused && styles.focused,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.controlLabel}>{t('common.details')}</Text>
                    </Pressable>
                  ) : null}
                  {configurableEndpoint || needsManifest ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={copy.replaceUrl}
                      testID={`provider-replace-manifest-${addonId}`}
                      onPress={() => setReplacing(record)}
                      style={({ focused, pressed }) => [
                        styles.controlButton,
                        focused && styles.focused,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.controlLabel}>
                        {needsManifest ? copy.finishSetup : copy.replaceUrl}
                      </Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('settings.remove')}
                    testID={`provider-remove-${addonId}`}
                    onPress={() => runMutation(() => remove(addonId))}
                    style={({ focused, pressed }) => [
                      styles.controlButton,
                      styles.removeButton,
                      focused && styles.focused,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.removeText}>{t('settings.remove')}</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
        </>
      )}
    </ScrollView>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: {
    width: '100%',
    maxWidth: 940,
    alignSelf: 'center',
    paddingHorizontal: '5%',
    paddingTop: 28,
    paddingBottom: 110,
  },
  header: { alignItems: 'center', gap: 13, marginBottom: 28 },
  headingCopy: { flex: 1 },
  headerButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  headerButtonText: { color: theme.colors.text, fontSize: 27, fontWeight: '600' },
  addButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#ffffff',
  },
  addLabel: { color: '#09090b', fontSize: 23, lineHeight: 25, fontWeight: '700' },
  title: { color: theme.colors.text, fontSize: 29, lineHeight: 35, fontWeight: '900', letterSpacing: -0.6 },
  subtitle: { color: theme.colors.muted, fontSize: 12, lineHeight: 18, marginTop: 3 },
  stateCard: {
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 16,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.lg,
  },
  status: { color: theme.colors.muted, fontSize: 15, textAlign: 'center' },
  error: { color: theme.colors.danger, fontSize: 14, textAlign: 'center' },
  list: { gap: 12 },
  providerRow: {
    gap: 16,
    padding: 17,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
  },
  providerRowAttention: {
    borderColor: theme.colors.accentSoft,
  },
  setupBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 13,
    marginBottom: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceElevated,
  },
  setupBannerText: {
    flex: 1,
    color: theme.colors.text,
    fontFamily: fontFamily.ui,
    fontSize: 13,
    lineHeight: 19,
  },
  providerHeader: { alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  providerIdentity: { flex: 1, gap: 5 },
  providerName: { color: theme.colors.text, fontSize: 17, fontWeight: '900' },
  providerId: { color: theme.colors.muted, fontSize: 9, opacity: 0.75 },
  setupDetail: {
    color: theme.colors.muted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  capabilities: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 5 },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: theme.colors.surfaceElevated,
  },
  badgeAccent: { backgroundColor: 'rgba(229,9,20,0.16)' },
  badgeText: { color: theme.colors.muted, fontSize: 9, fontWeight: '900' },
  badgeTextAccent: { color: theme.colors.accentSoft },
  toggleButton: {
    width: 49,
    height: 29,
    justifyContent: 'center',
    borderRadius: 999,
    paddingHorizontal: 3,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceElevated,
  },
  toggleButtonOn: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  toggleKnob: { width: 21, height: 21, borderRadius: 999, backgroundColor: theme.colors.muted },
  toggleKnobOn: { alignSelf: 'flex-end', backgroundColor: '#ffffff' },
  controls: { flexWrap: 'wrap', gap: 7 },
  controlButton: {
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: 11,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceElevated,
  },
  controlLabel: { color: theme.colors.text, fontSize: 10, fontWeight: '800' },
  removeButton: { marginLeft: 'auto' },
  removeText: { color: theme.colors.danger, fontSize: 10, fontWeight: '900' },
  focused: { borderColor: theme.colors.focus },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.72 },
});

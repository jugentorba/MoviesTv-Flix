import React, { useContext, useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import type { StreamSource } from '@moviestv/core';
import { type Theme, fontFamily } from '@moviestv/ui';
import { useI18n } from '../i18n/useI18n';
import { safeInsetEdge } from '../app/safeAreaLayout';
import { useWebTvModalFocusRestore } from '../web/tvRemoteNavigation';
import { sourceFacts } from './sourceFacts';
import { IconBackButton } from '../components/IconBackButton';
import { useSwipeBack } from '../components/useSwipeBack';
import {
  formatBytes,
  groupSources,
  providerOptions,
  qualityLabel,
  resolutionBucket,
} from './sourceGroups';
import { useThemeStyles } from '../theme/ThemeProvider';

export interface SourceChooserMedia {
  title: string;
  seriesTitle?: string;
  /** `S3 E17` — the line above the title. */
  eyebrow?: string;
  posterUrl?: string;
}

interface SourceChooserProps {
  sources: readonly StreamSource[];
  selectedSourceId: string | null;
  onSelect(sourceId: string): void;
  onClose(): void;
  media?: SourceChooserMedia;
  /** Show a "Resume from 12:05" pill when playback will continue mid-film. */
  resumeSeconds?: number;
  onResume?(): void;
  onRefresh?(): void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

/** Every language the source says it carries; empty when it declares none. */
function sourceLanguages(source: StreamSource): string[] {
  const declared = [
    ...(source.audioLanguages ?? []),
    ...(source.language ? [source.language] : []),
  ]
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));
  return [...new Set(declared)];
}

export function SourceChooser({
  sources,
  selectedSourceId,
  onSelect,
  onClose,
  media,
  resumeSeconds = 0,
  onResume,
  onRefresh,
}: SourceChooserProps) {
  const styles = useThemeStyles(createStyles);
  const { t } = useI18n();
  const [provider, setProvider] = useState<string>('all');
  const [language, setLanguage] = useState<string>('all');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const providers = useMemo(() => providerOptions(sources), [sources]);
  const swipeHandlers = useSwipeBack(onClose);

  const languageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const source of sources) {
      for (const code of sourceLanguages(source)) {
        counts.set(code, (counts.get(code) ?? 0) + 1);
      }
    }
    return counts;
  }, [sources]);

  const visibleSources = useMemo(
    () => sources.filter((source) => (
      (provider === 'all' || (source.providerId?.trim() || 'unknown') === provider)
      && (language === 'all' || sourceLanguages(source).includes(language))
    )),
    [language, provider, sources],
  );

  const groups = useMemo(() => groupSources(visibleSources), [visibleSources]);

  const safeAreaInsets = useContext(SafeAreaInsetsContext) ?? {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };
  useWebTvModalFocusRestore(true);

  const toggleGroup = (bucket: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(bucket)) next.delete(bucket);
      else next.add(bucket);
      return next;
    });
  };

  return (
    <View
      aria-modal={true}
      style={styles.screen}
      testID="source-chooser"
      {...swipeHandlers}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{
          paddingBottom: safeInsetEdge(32, safeAreaInsets.bottom, 20),
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          {media?.posterUrl ? (
            <Image
              source={{ uri: media.posterUrl }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              blurRadius={18}
            />
          ) : null}
          <LinearGradient
            colors={['rgba(8,8,12,0.55)', 'rgba(8,8,12,0.86)', '#08080c']}
            locations={[0, 0.62, 1]}
            style={StyleSheet.absoluteFill}
          />

          <View
            style={{
              paddingTop: safeInsetEdge(14, safeAreaInsets.top, 8),
              paddingLeft: safeInsetEdge(18, safeAreaInsets.left, 12),
              paddingRight: safeInsetEdge(18, safeAreaInsets.right, 12),
            }}
          >
            <IconBackButton
              label={t('common.back')}
              onPress={onClose}
              testID="source-chooser-back"
            />
          </View>

          <View
            style={[
              styles.heroCopy,
              {
                paddingLeft: safeInsetEdge(20, safeAreaInsets.left, 14),
                paddingRight: safeInsetEdge(20, safeAreaInsets.right, 14),
              },
            ]}
          >
            {media?.eyebrow ? (
              <Text style={styles.eyebrow}>{media.eyebrow}</Text>
            ) : null}
            <Text numberOfLines={2} style={styles.mediaTitle}>
              {media?.title ?? t('playback.sources')}
            </Text>
            <Text numberOfLines={1} style={styles.mediaMeta}>
              {media?.seriesTitle ?? `${sources.length} ${t('playback.sources').toLowerCase()}`}
            </Text>
          </View>
        </View>

        <View
          style={[
            styles.body,
            {
              paddingLeft: safeInsetEdge(16, safeAreaInsets.left, 10),
              paddingRight: safeInsetEdge(16, safeAreaInsets.right, 10),
            },
          ]}
        >
          {resumeSeconds > 0 && onResume ? (
            <Pressable
              accessibilityRole="button"
              testID="source-resume"
              onPress={onResume}
              style={({ pressed }) => [styles.resumePill, pressed && styles.pressed]}
            >
              <Text style={styles.resumeText}>
                {t('playback.resumeFrom', { time: formatTime(resumeSeconds) })}
              </Text>
            </Pressable>
          ) : null}

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
          >
            {onRefresh ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('playback.refreshSources')}
                testID="source-refresh"
                hitSlop={8}
                onPress={onRefresh}
                style={({ pressed }) => [styles.iconChip, pressed && styles.pressed]}
              >
                <Text style={styles.iconChipText}>↻</Text>
              </Pressable>
            ) : null}
            <Pressable
              testID="source-filter-all"
              accessibilityRole="button"
              onPress={() => setProvider('all')}
              style={({ pressed }) => [
                styles.chip,
                provider === 'all' && styles.chipActive,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.chipText, provider === 'all' && styles.chipTextActive]}>
                {t('playback.allSources')}
              </Text>
            </Pressable>
            {providers.map((option) => (
              <Pressable
                key={option.id}
                testID={`source-filter-${option.id}`}
                accessibilityRole="button"
                accessibilityLabel={`${option.label} · ${option.count}`}
                onPress={() => setProvider(option.id)}
                style={({ pressed }) => [
                  styles.chip,
                  provider === option.id && styles.chipActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.chipText, provider === option.id && styles.chipTextActive]}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {languageCounts.size > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
            >
              <Pressable
                testID="source-language-all"
                accessibilityRole="button"
                onPress={() => setLanguage('all')}
                style={({ pressed }) => [
                  styles.chip,
                  styles.chipQuiet,
                  language === 'all' && styles.chipQuietActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.chipText, language === 'all' && styles.chipTextActive]}>
                  {t('playback.anyLanguage')}
                </Text>
              </Pressable>
              {[...languageCounts.entries()]
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .map(([code, count]) => (
                  <Pressable
                    key={code}
                    testID={`source-language-${code}`}
                    accessibilityRole="button"
                    onPress={() => setLanguage(code)}
                    style={({ pressed }) => [
                      styles.chip,
                      styles.chipQuiet,
                      language === code && styles.chipQuietActive,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.chipText, language === code && styles.chipTextActive]}>
                      {code.toUpperCase()} {count}
                    </Text>
                  </Pressable>
                ))}
            </ScrollView>
          ) : null}

          {groups.length === 0 ? (
            <Text style={styles.empty}>{t('playback.noSourcesMatch')}</Text>
          ) : null}

          {groups.map((group) => {
            const isCollapsed = collapsed.has(group.bucket);
            const size = formatBytes(group.sizeBytes);
            return (
              <View key={group.bucket} style={styles.group}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: !isCollapsed }}
                  testID={`source-group-${group.bucket}`}
                  onPress={() => toggleGroup(group.bucket)}
                  style={({ pressed }) => [styles.groupCard, pressed && styles.pressed]}
                >
                  <View style={styles.groupCopy}>
                    <Text style={styles.groupTitle}>{group.label}</Text>
                    <Text style={styles.groupMeta}>
                      {[
                        group.tag,
                        group.count === 1
                          ? t('playback.sourceCountOne')
                          : t('playback.sourceCount', { count: group.count }),
                      ].filter(Boolean).join(' · ')}
                    </Text>
                    {size ? (
                      <View style={styles.sizeBadge}>
                        <Text style={styles.sizeText}>
                          {t('playback.detailsSize').toUpperCase()} {size}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.groupChevron}>{isCollapsed ? '＋' : '−'}</Text>
                </Pressable>

                {isCollapsed ? null : group.sources.map((source, index) => {
                  const selected = source.id === selectedSourceId;
                  const languages = sourceLanguages(source);
                  const title = source.name ?? source.providerId ?? source.sourceId ?? `Source ${index + 1}`;
                  const facts = sourceFacts(source);
                  const sourceSize = formatBytes(source.sizeBytes);

                  return (
                    <Pressable
                      key={source.id}
                      testID={`source-${source.id}`}
                      focusable
                      onPress={() => onSelect(source.id)}
                      style={({ focused, pressed }) => [
                        styles.source,
                        selected && styles.sourceSelected,
                        focused && styles.focused,
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={styles.sourceTop}>
                        <View style={styles.sourceCopy}>
                          <Text testID="source-label" numberOfLines={2} style={styles.sourceName}>
                            {title}
                          </Text>
                          <Text numberOfLines={1} style={styles.providerName}>
                            {[source.providerId, qualityLabel(resolutionBucket(source))]
                              .filter(Boolean).join(' · ')}
                          </Text>
                        </View>
                        <Pressable
                          testID={`source-info-${source.id}`}
                          focusable
                          accessibilityRole="button"
                          accessibilityLabel={t('playback.sourceInfo')}
                          hitSlop={8}
                          onPress={() => setExpandedId(expandedId === source.id ? null : source.id)}
                          style={({ pressed }) => [styles.infoButton, pressed && styles.pressed]}
                        >
                          <Text style={styles.infoButtonText}>i</Text>
                        </Pressable>
                        {selected ? (
                          <View style={styles.selectedBadge}>
                            <Text style={styles.selectedText}>✓ {t('playback.selected')}</Text>
                          </View>
                        ) : null}
                      </View>

                      <View style={styles.metadata}>
                        {source.quality ? <Badge strong>{source.quality}</Badge> : null}
                        {languages.map((code) => <Badge key={code}>{code.toUpperCase()}</Badge>)}
                        {source.codec ? <Badge>{source.codec.toUpperCase()}</Badge> : null}
                        {facts.container ? <Badge>{facts.container}</Badge> : null}
                        {facts.audio ? <Badge>{facts.audio}</Badge> : null}
                        {sourceSize ? <Badge>{sourceSize}</Badge> : null}
                        {source.headers && Object.keys(source.headers).length ? <Badge>HTTP</Badge> : null}
                      </View>

                      {expandedId === source.id ? (
                        <View style={styles.infoPanel} testID={`source-details-${source.id}`}>
                          {[
                            [t('playback.detailsContainer'), [facts.container, source.filename].filter(Boolean).join(' · ')],
                            [t('playback.detailsVideo'), [source.codec, source.codecDetail, source.dynamicRange?.toUpperCase()].filter(Boolean).join(' · ')],
                            [t('playback.detailsAudio'), [facts.audio, languages.join(', ')].filter(Boolean).join(' · ')],
                            [t('playback.detailsSubtitles'), (source.subtitleLanguages ?? []).join(', ')],
                            [t('playback.detailsSize'), sourceSize ?? '—'],
                            [t('playback.detailsProvider'), [source.providerId, source.sourceId].filter(Boolean).join(' · ')],
                          ].map(([label, value]) => (
                            <View key={label} style={styles.infoRow}>
                              <Text style={styles.infoLabel}>{label}</Text>
                              <Text style={styles.infoValue} numberOfLines={2}>{value || '—'}</Text>
                            </View>
                          ))}
                          <Text style={[styles.infoVerdict, !facts.containerIsBlocking && styles.infoVerdictOk]}>
                            {facts.containerIsBlocking ? t('playback.mayNotPlay') : t('playback.playsHere')}
                          </Text>
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function Badge({ children, strong = false }: { children: React.ReactNode; strong?: boolean }) {
  const styles = useThemeStyles(createStyles);
  return (
    <View style={[styles.badge, strong && styles.badgeStrong]}>
      <Text style={[styles.badgeText, strong && styles.badgeTextStrong]}>{children}</Text>
    </View>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  screen: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1200,
    backgroundColor: '#08080c',
  },
  scroll: { flex: 1 },
  hero: {
    minHeight: 232,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  heroCopy: { paddingTop: 26, paddingBottom: 18, gap: 3 },
  eyebrow: {
    color: 'rgba(255,255,255,0.72)',
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  mediaTitle: {
    color: '#ffffff',
    fontFamily: fontFamily.displayBold,
    fontSize: 30,
    lineHeight: 35,
    letterSpacing: -0.6,
  },
  mediaMeta: {
    color: 'rgba(255,255,255,0.66)',
    fontFamily: fontFamily.ui,
    fontSize: 14,
  },
  body: { gap: 10, paddingTop: 4 },
  resumePill: {
    alignSelf: 'flex-start',
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  resumeText: { color: '#ffffff', fontFamily: fontFamily.uiSemiBold, fontSize: 14 },
  chips: { gap: 8, paddingVertical: 4 },
  chip: {
    paddingHorizontal: 15,
    paddingVertical: 9,
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  chipActive: { backgroundColor: '#ffffff' },
  chipQuiet: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  chipQuietActive: { backgroundColor: 'rgba(255,255,255,0.16)', borderColor: 'rgba(255,255,255,0.4)' },
  chipText: { color: 'rgba(255,255,255,0.78)', fontFamily: fontFamily.uiSemiBold, fontSize: 13 },
  chipTextActive: { color: '#0b0b0f' },
  iconChip: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  iconChipText: { color: '#ffffff', fontSize: 16, fontFamily: fontFamily.uiSemiBold },
  empty: {
    color: 'rgba(255,255,255,0.6)',
    fontFamily: fontFamily.ui,
    fontSize: 13,
    lineHeight: 19,
    paddingVertical: 14,
  },
  group: { gap: 8, marginTop: 10 },
  groupCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.07)',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  groupCopy: { flex: 1, gap: 4 },
  groupTitle: {
    color: '#ffffff',
    fontFamily: fontFamily.displayBold,
    fontSize: 20,
    letterSpacing: -0.3,
  },
  groupMeta: {
    color: 'rgba(255,255,255,0.62)',
    fontFamily: fontFamily.ui,
    fontSize: 13,
  },
  sizeBadge: {
    alignSelf: 'flex-start',
    marginTop: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  sizeText: {
    color: '#ffffff',
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 11,
    letterSpacing: 0.4,
  },
  groupChevron: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 18,
    fontFamily: fontFamily.uiSemiBold,
  },
  source: {
    minHeight: 74,
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 9,
  },
  sourceSelected: {
    borderColor: theme.colors.accent,
    backgroundColor: 'rgba(108,75,239,0.16)',
  },
  sourceTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  sourceCopy: { flex: 1 },
  sourceName: { color: '#ffffff', fontSize: 15, lineHeight: 20, fontWeight: '800' },
  providerName: { color: 'rgba(255,255,255,0.5)', fontSize: 10, marginTop: 3 },
  selectedBadge: {
    borderRadius: 999,
    backgroundColor: 'rgba(108,75,239,0.3)',
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  selectedText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },
  metadata: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: {
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.10)',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeStrong: { backgroundColor: 'rgba(255,255,255,0.20)' },
  badgeText: { color: 'rgba(255,255,255,0.76)', fontSize: 9, fontWeight: '900' },
  badgeTextStrong: { color: '#ffffff' },
  infoButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  infoButtonText: { color: 'rgba(255,255,255,0.8)', fontFamily: fontFamily.uiSemiBold, fontSize: 12 },
  infoPanel: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.16)',
    gap: 6,
  },
  infoRow: { flexDirection: 'row', gap: 10 },
  infoLabel: { width: 92, color: 'rgba(255,255,255,0.5)', fontFamily: fontFamily.ui, fontSize: 12 },
  infoValue: { flex: 1, color: '#ffffff', fontFamily: fontFamily.ui, fontSize: 12 },
  infoVerdict: {
    marginTop: 4,
    color: theme.colors.warning,
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 12,
  },
  infoVerdictOk: { color: theme.colors.success },
  focused: { borderColor: '#ffffff' },
  pressed: { opacity: 0.72 },
});

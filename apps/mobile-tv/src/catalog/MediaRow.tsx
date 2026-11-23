import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { CatalogMediaItem, CatalogSection } from '@moviestv/catalog';
import { type Theme } from '@moviestv/ui';
import { MediaCard } from './MediaCard';
import { useTheme, useThemeStyles } from '../theme/ThemeProvider';

interface MediaRowProps {
  section: CatalogSection;
  items: CatalogMediaItem[];
  onSelectMedia(item: CatalogMediaItem): void;
  onLongPressMedia?(item: CatalogMediaItem): void;
  onPrefetchMedia?(item: CatalogMediaItem): void;
  /** mediaId → 0–1, drawn on the poster. */
  progressByMediaId?: Record<string, number>;
  /** mediaId → finished, drawn as a check. */
  watchedByMediaId?: Record<string, boolean>;
  onLoadMore?(): void;
  loadingMore?: boolean;
  loadMoreLabel?: string;
}

function MediaRowView({
  section,
  items,
  onSelectMedia,
  onLongPressMedia,
  onPrefetchMedia,
  progressByMediaId,
  watchedByMediaId,
  onLoadMore,
  loadingMore = false,
  loadMoreLabel = 'Load more',
}: MediaRowProps) {
  const styles = useThemeStyles(createStyles);
  const theme = useTheme();
  const visibleItems = items.filter((item) => item.id?.trim() && item.title?.trim()).slice(0, 200);
  if (!visibleItems.length || !section.title?.trim()) return null;

  return (
    <View style={styles.row}>
      <View style={styles.headingLine}>
        <Text style={styles.heading}>{section.title.trim()}</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.cards}
      >
        {visibleItems.map((item, index) => (
          <MediaCard
            key={`${item.providerId ?? 'catalog'}:${item.id}:${index}`}
            item={item}
            onPress={onSelectMedia}
            {...(onLongPressMedia ? { onLongPress: onLongPressMedia } : {})}
            {...(onPrefetchMedia ? { onPressIn: onPrefetchMedia } : {})}
            {...(progressByMediaId?.[item.id] !== undefined
              ? { progressRatio: progressByMediaId[item.id] }
              : {})}
            {...(watchedByMediaId?.[item.id] ? { watched: true } : {})}
          />
        ))}
        {onLoadMore ? (
          <Pressable
            accessibilityRole="button"
            focusable={!loadingMore}
            disabled={loadingMore}
            testID={`catalog-row-load-more-${section.id}`}
            onPress={onLoadMore}
            style={({ focused, pressed }) => [
              styles.loadMore,
              focused && styles.loadMoreFocused,
              pressed && styles.loadMorePressed,
              loadingMore && styles.loadMoreDisabled,
            ]}
          >
            {loadingMore ? (
              <ActivityIndicator color={theme.colors.accent} />
            ) : (
              <Text style={styles.loadMoreText}>{loadMoreLabel}</Text>
            )}
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

export const MediaRow = React.memo(MediaRowView);

const createStyles = (theme: Theme) => StyleSheet.create({
  row: { marginBottom: 40 },
  headingLine: {
    paddingHorizontal: '4%',
    marginBottom: 14,
  },
  heading: {
    color: theme.colors.text,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '900',
    letterSpacing: -0.35,
  },
  cards: {
    gap: 14,
    paddingLeft: '4%',
    paddingRight: 32,
  },
  loadMore: {
    width: 132,
    minHeight: 210,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 12,
  },
  loadMoreFocused: {
    borderColor: theme.colors.focus,
    transform: [{ scale: 1.04 }],
  },
  loadMorePressed: { opacity: 0.72 },
  loadMoreDisabled: { opacity: 0.65 },
  loadMoreText: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'center',
  },
});

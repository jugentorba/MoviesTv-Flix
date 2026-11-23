import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { CatalogMediaItem } from '@moviestv/catalog';
import { type Theme } from '@moviestv/ui';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFormFactor } from '../app/platform';
import { useThemeStyles } from '../theme/ThemeProvider';

interface MediaCardProps {
  item: CatalogMediaItem;
  onPress(item: CatalogMediaItem): void;
  /** Optional quick actions; phones only, TV keeps the plain focus behaviour. */
  onLongPress?(item: CatalogMediaItem): void;
  /** Fired on touch-down, before navigation, so the caller can prefetch. */
  onPressIn?(item: CatalogMediaItem): void;
  /** 0–1: draws a progress bar on the poster, as Continue Watching does. */
  progressRatio?: number;
  /** Finished: a small check on the poster. */
  watched?: boolean;
}

function MediaCardView({ item, onPress, onLongPress, onPressIn, progressRatio, watched }: MediaCardProps) {
  const styles = useThemeStyles(createStyles);
  const [focused, setFocused] = useState(false);
  const { width } = useWindowDimensions();
  const formFactor = useFormFactor();
  const tv = formFactor === 'tv';
  const compact = width < 520;

  if (!item.id?.trim() || !item.title?.trim()) return null;

  return (
    <Pressable
      accessibilityRole="button"
      focusable
      onPress={() => onPress({ ...item, id: item.id.trim(), title: item.title.trim() })}
      onPressIn={onPressIn
        ? () => onPressIn({ ...item, id: item.id.trim(), title: item.title.trim() })
        : undefined}
      onLongPress={onLongPress && !tv
        ? () => onLongPress({ ...item, id: item.id.trim(), title: item.title.trim() })
        : undefined}
      delayLongPress={380}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        styles.card,
        compact && styles.compactCard,
        tv && styles.tvCard,
        focused && styles.focusedCard,
      ]}
    >
      {item.posterUrl ? (
        <Image source={{ uri: item.posterUrl }} style={styles.poster} resizeMode="cover" />
      ) : (
        <View style={styles.posterFallback}>
          <Text style={styles.posterLetter}>{item.title.slice(0, 1).toUpperCase()}</Text>
        </View>
      )}
      {watched ? (
        <View testID="media-card-watched" style={styles.watchedBadge}>
          <Ionicons name="checkmark" size={12} color="#0b0b0f" />
        </View>
      ) : null}
      {typeof progressRatio === 'number' && progressRatio > 0 ? (
        <View testID="media-card-progress" style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${Math.max(0, Math.min(1, progressRatio)) * 100}%` as `${number}%` },
            ]}
          />
        </View>
      ) : null}
      <View style={styles.caption}>
        <Text numberOfLines={1} style={styles.title}>{item.title}</Text>
        <View style={styles.metaLine}>
          {Number.isInteger(item.year) && item.year! >= 1888 && item.year! <= 3000 ? <Text style={styles.detail}>{item.year}</Text> : null}
          {typeof item.rating === 'number' && Number.isFinite(item.rating) ? <Text style={styles.rating}>★ {Math.max(0, Math.min(10, item.rating)).toFixed(1)}</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}

/*
 * A row can hold two hundred posters, and every catalog state change re-renders
 * the screen. Memoising the card means only cards whose item or handlers changed
 * do any work; the handlers are stabilised by the screens.
 */
export const MediaCard = React.memo(MediaCardView);

const createStyles = (theme: Theme) => StyleSheet.create({
  card: {
    width: 168,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  compactCard: { width: 142 },
  tvCard: { width: 210 },
  focusedCard: {
    borderColor: theme.colors.focus,
    backgroundColor: theme.colors.surfaceElevated,
    transform: [{ scale: 1.06 }],
  },
  poster: {
    width: '100%',
    aspectRatio: 2 / 3,
    borderRadius: 12,
    backgroundColor: theme.colors.surfaceElevated,
  },
  posterFallback: {
    width: '100%',
    aspectRatio: 2 / 3,
    borderRadius: 12,
    backgroundColor: theme.colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  posterLetter: { color: theme.colors.accent, fontSize: 44, fontWeight: '900' },
  caption: { paddingTop: 9, paddingHorizontal: 2, paddingBottom: 4 },
  title: { color: theme.colors.text, fontSize: 14, fontWeight: '900' },
  watchedBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    zIndex: 2,
  },
  progressTrack: {
    height: 4,
    marginTop: 6,
    marginHorizontal: 2,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    overflow: 'hidden',
  },
  progressFill: { height: 4, backgroundColor: theme.colors.accent },
  metaLine: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 8 },
  detail: { color: theme.colors.muted, fontSize: 11, fontWeight: '700' },
  rating: { color: '#e3e3e6', fontSize: 11, fontWeight: '900' },
});

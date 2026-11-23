import React from 'react';
import {
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { CatalogMediaItem } from '@moviestv/catalog';
import { fontFamily, type Theme } from '@moviestv/ui';
import { useI18n } from '../i18n/useI18n';
import { useThemeStyles } from '../theme/ThemeProvider';

/**
 * The long-press sheet on a catalog card.
 *
 * Browsing is mostly "what is this" and "save it for later", so both answers
 * are one press away instead of a full details round trip.
 */
export function MediaQuickActions({
  item,
  inMyList,
  onToggleMyList,
  onOpenDetails,
  onClose,
}: {
  item: CatalogMediaItem | null;
  inMyList: boolean;
  onToggleMyList(): void;
  onOpenDetails(): void;
  onClose(): void;
}) {
  const styles = useThemeStyles(createStyles);
  const { t } = useI18n();

  return (
    <Modal
      visible={item !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('playback.close')}
        testID="quick-actions-backdrop"
        onPress={onClose}
        style={styles.backdrop}
      >
        <Pressable
          testID="media-quick-actions"
          onPress={(event) => event.stopPropagation()}
          style={styles.sheet}
        >
          <View style={styles.head}>
            {item?.posterUrl ? (
              <Image source={{ uri: item.posterUrl }} style={styles.poster} resizeMode="cover" />
            ) : (
              <View style={[styles.poster, styles.posterFallback]}>
                <Text style={styles.posterLetter}>
                  {(item?.title ?? '?').slice(0, 1).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.headCopy}>
              <Text numberOfLines={2} style={styles.title}>{item?.title ?? ''}</Text>
              <Text numberOfLines={1} style={styles.meta}>
                {[item?.year, item?.kind === 'series' ? t('common.series') : t('common.movie')]
                  .filter(Boolean).join(' · ')}
              </Text>
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            testID="quick-actions-my-list"
            onPress={onToggleMyList}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <Ionicons
              name={inMyList ? 'checkmark-circle' : 'add-circle-outline'}
              size={21}
              color="#ffffff"
            />
            <Text style={styles.actionText}>
              {inMyList ? t('catalog.removeFromMyList') : t('catalog.addToMyList')}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            testID="quick-actions-details"
            onPress={onOpenDetails}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <Ionicons name="information-circle-outline" size={21} color="#ffffff" />
            <Text style={styles.actionText}>{t('common.details')}</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            testID="quick-actions-close"
            onPress={onClose}
            style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
          >
            <Text style={styles.cancelText}>{t('common.cancel')}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 26,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 6 },
  poster: { width: 48, height: 68, borderRadius: 8, backgroundColor: theme.colors.surfaceElevated },
  posterFallback: { alignItems: 'center', justifyContent: 'center' },
  posterLetter: { color: theme.colors.muted, fontFamily: fontFamily.displayBold, fontSize: 22 },
  headCopy: { flex: 1, gap: 3 },
  title: { color: theme.colors.text, fontFamily: fontFamily.displayBold, fontSize: 18 },
  meta: { color: theme.colors.muted, fontFamily: fontFamily.ui, fontSize: 12 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: theme.colors.surfaceElevated,
  },
  actionText: { color: theme.colors.text, fontFamily: fontFamily.uiMedium, fontSize: 15 },
  cancel: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  cancelText: { color: theme.colors.muted, fontFamily: fontFamily.uiSemiBold, fontSize: 14 },
  pressed: { opacity: 0.65 },
});

import type { ComponentProps } from 'react';
import type Ionicons from '@expo/vector-icons/Ionicons';

/**
 * Preset profile avatars.
 *
 * A fixed set rather than photo uploads: a photo needs storage, moderation and a
 * sync story, and a coloured tile with a glyph reads instantly on a TV at three
 * metres. Colours are picked to stay distinguishable from each other and to sit
 * on the app's dark surface.
 */
export interface ProfileAvatar {
  id: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  color: string;
}

export const PROFILE_AVATARS: readonly ProfileAvatar[] = [
  { id: 'violet', icon: 'person', color: '#6C4BEF' },
  { id: 'coral', icon: 'sparkles', color: '#FF7A45' },
  { id: 'teal', icon: 'rocket', color: '#2BC4A8' },
  { id: 'rose', icon: 'heart', color: '#F25C7A' },
  { id: 'amber', icon: 'star', color: '#FFB020' },
  { id: 'sky', icon: 'planet', color: '#4C9BFF' },
  { id: 'mint', icon: 'leaf', color: '#57D07A' },
  { id: 'plum', icon: 'moon', color: '#9B82FF' },
  { id: 'steel', icon: 'game-controller', color: '#8C93A8' },
  { id: 'sun', icon: 'sunny', color: '#FFD24C' },
  { id: 'flame', icon: 'flame', color: '#FF5A5F' },
  { id: 'ghost', icon: 'skull', color: '#B8BED0' },
];

/** Falls back to the first avatar when an unknown or missing id is stored. */
export function avatarFor(avatarId?: string): ProfileAvatar {
  return PROFILE_AVATARS.find((avatar) => avatar.id === avatarId) ?? PROFILE_AVATARS[0];
}

import React from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

/**
 * The back affordance used by every sub-screen.
 *
 * It used to be a wide text button reading "‹ Back" (or just "Back"), which
 * cost a third of the header on a phone and looked different on every screen.
 * A 40 pt circle with a chevron leaves room for the screen title, and
 * `hitSlop` keeps it comfortable to tap without being visually loud.
 */
export function IconBackButton({
  onPress,
  label,
  testID = 'screen-back',
  tint,
}: {
  onPress(): void;
  label: string;
  testID?: string;
  tint?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      hitSlop={14}
      onPress={onPress}
      style={({ focused, pressed }: { focused?: boolean; pressed: boolean }) => [
        styles.button,
        {
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surfaceElevated,
        },
        focused && styles.focused,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons name="chevron-back" size={20} color={tint ?? theme.colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  focused: { borderColor: '#ffffff' },
  pressed: { opacity: 0.6 },
});

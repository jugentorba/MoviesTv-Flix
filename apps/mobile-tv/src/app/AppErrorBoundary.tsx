import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fontFamily, themes } from '@moviestv/ui';

interface Props {
  children: React.ReactNode;
  /** Lets a test or a host screen supply its own recovery action. */
  onReset?(): void;
}

interface State {
  error: Error | null;
}

/**
 * Catches a render error and shows a real screen instead of a blank window.
 *
 * React unmounts the whole tree when a render throws, which in this app means a
 * white (iOS) or empty (Android) window with no way out. A boundary keeps the
 * shell alive and offers a retry that remounts the children.
 *
 * It deliberately uses the default dark palette rather than `useTheme`: the
 * failure may have happened inside the theme provider itself.
 */
export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    // Keep the message in the device log; the UI never shows a stack trace.
    console.error('[app] render error', error?.message ?? error);
  }

  private reset = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <View style={styles.screen} testID="app-error-boundary">
        <View style={styles.card}>
          <Text style={styles.eyebrow}>SOMETHING BROKE</Text>
          <Text style={styles.title}>This screen could not be drawn</Text>
          <Text style={styles.body}>
            The rest of the app is still here. Try again, and if it keeps happening the
            problem is on this screen rather than your account or providers.
          </Text>
          <Pressable
            accessibilityRole="button"
            testID="app-error-retry"
            onPress={this.reset}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          >
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>
      </View>
    );
  }
}

const theme = themes.dark;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: theme.colors.background,
  },
  card: {
    width: '100%',
    maxWidth: 520,
    gap: 10,
    padding: 24,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  eyebrow: {
    color: theme.colors.muted,
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 11,
    letterSpacing: 1.4,
  },
  title: {
    color: theme.colors.text,
    fontFamily: fontFamily.displayBold,
    fontSize: 26,
  },
  body: {
    color: theme.colors.muted,
    fontFamily: fontFamily.ui,
    fontSize: 14,
    lineHeight: 20,
  },
  button: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: theme.colors.accent,
  },
  buttonText: {
    color: theme.colors.onAccent,
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 14,
  },
  pressed: { opacity: 0.75 },
});

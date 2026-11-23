import React, { Suspense } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { registerPwa } from './src/web/registerPwa';
import { safeBootErrorMessage } from './src/web/safeErrorMessage';
import LoadAppRoot from './src/app/loadAppRoot';

if (Platform.OS === 'web') registerPwa();


interface BootErrorBoundaryState {
  error: string | null;
}

class BootErrorBoundary extends React.Component<
  React.PropsWithChildren,
  BootErrorBoundaryState
> {
  state: BootErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BootErrorBoundaryState {
    return {
      error: safeBootErrorMessage(error),
    };
  }

  componentDidCatch() {
    if (Platform.OS === 'web') {
      console.error('MoviesTv-Flix failed to start');
    }
  }

  render() {
    if (this.state.error) {
      return (
        <ScrollView
          contentContainerStyle={styles.errorScreen}
          testID="web-boot-error"
        >
          <Text style={styles.brand}>MOVIESTV-FLIX</Text>
          <Text style={styles.title}>The app could not start.</Text>
          <Text style={styles.message}>{this.state.error}</Text>
          <Text style={styles.hint}>
            Reload the app. If the problem continues, check for an updated version.
          </Text>
        </ScrollView>
      );
    }

    return this.props.children;
  }
}

function LoadingScreen() {
  return (
    <View style={styles.loadingScreen}>
      <Text style={styles.brand}>MOVIESTV-FLIX</Text>
      <Text style={styles.loadingText}>Starting…</Text>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <BootErrorBoundary>
        <View style={styles.app}>
          <Suspense fallback={<LoadingScreen />}>
            <LoadAppRoot />
          </Suspense>
        </View>
      </BootErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  app: {
    flex: 1,
  },
  loadingScreen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#09090b',
    padding: 28,
  },
  loadingText: {
    color: '#fafafa',
    fontSize: 18,
    fontWeight: '700',
  },
  errorScreen: {
    flexGrow: 1,
    justifyContent: 'center',
    backgroundColor: '#09090b',
    padding: 28,
  },
  brand: {
    color: '#a78bfa',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: 14,
  },
  title: {
    color: '#fafafa',
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 14,
  },
  message: {
    color: '#fca5a5',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 16,
  },
  hint: {
    color: '#a1a1aa',
    fontSize: 13,
    lineHeight: 19,
  },
});

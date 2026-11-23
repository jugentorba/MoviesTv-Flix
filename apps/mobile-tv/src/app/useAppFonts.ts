import { useFonts } from 'expo-font';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { Sora_600SemiBold, Sora_700Bold } from '@expo-google-fonts/sora';

/**
 * Registers the app's fonts under the names used by `fontFamily` in
 * `@moviestv/ui`, so a token can name "Inter" or "Sora-SemiBold" and get the
 * right file on every platform.
 *
 * If a font fails to load, React Native falls back to the system font. The app
 * still renders — a missing font must not be a blank screen.
 */
export function useAppFonts(): [boolean, Error | null] {
  const [loaded, error] = useFonts({
    Inter: Inter_400Regular,
    'Inter-Medium': Inter_500Medium,
    'Inter-SemiBold': Inter_600SemiBold,
    'Inter-Bold': Inter_700Bold,
    'Sora-SemiBold': Sora_600SemiBold,
    'Sora-Bold': Sora_700Bold,
  });
  return [loaded, error ?? null];
}

import * as SecureStore from 'expo-secure-store';
import type { SecureStoreAdapter } from './SecureAddonSecretStore';

export const runtimeAddonSecretStore: SecureStoreAdapter = SecureStore;

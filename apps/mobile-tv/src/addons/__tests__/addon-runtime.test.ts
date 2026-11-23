import { MemoryStore } from '@moviestv/storage';
import { createAddonRuntime } from '../AddonRuntime';

class MemorySecureStore {
  private readonly values = new Map<string, string>();

  async getItemAsync(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setItemAsync(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async deleteItemAsync(key: string): Promise<void> {
    this.values.delete(key);
  }
}

describe('createAddonRuntime', () => {
  test('keeps provider secrets in the injected secure store instead of metadata storage', async () => {
    const metadataStore = new MemoryStore();
    const secureStore = new MemorySecureStore();
    const runtime = createAddonRuntime({ metadataStore, secureStore });

    await runtime.secrets.set('provider.example', 'apiKey', 'top-secret');

    expect(await runtime.secrets.get('provider.example', 'apiKey')).toBe('top-secret');
    expect(await metadataStore.get('moviestv.addons')).toBeNull();
    await expect(runtime.coordinator.load(null)).resolves.toEqual({
      records: [],
      syncStatus: 'local',
      error: null,
    });
  });
});

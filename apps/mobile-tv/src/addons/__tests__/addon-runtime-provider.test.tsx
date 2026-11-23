import React from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { MemoryStore } from '@moviestv/storage';
import { AddonRuntimeProvider } from '../AddonRuntimeProvider';
import { useAddons } from '../useAddons';

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

function Probe() {
  const addons = useAddons();
  return <Text>{addons.ready ? addons.syncStatus : 'loading'}</Text>;
}

test('provides a local secure add-on runtime to descendants', async () => {
  render(
    <AddonRuntimeProvider
      metadataStore={new MemoryStore()}
      secureStore={new MemorySecureStore()}
    >
      <Probe />
    </AddonRuntimeProvider>,
  );

  expect(await screen.findByText('local')).toBeTruthy();
});

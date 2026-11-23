import {
  AddonRegistry,
  AddonSourceResolver,
  type AddonAdapter,
  type AddonDescriptor,
  type AddonStateRecord,
  type RegisteredAddon,
} from '@moviestv/addons';
import { StremioAddonAdapter } from '../addons/StremioAddonAdapter';

export type PlaybackAddonAdapterFactory = (descriptor: AddonDescriptor) => AddonAdapter;

function defaultAdapterFactory(descriptor: AddonDescriptor): AddonAdapter {
  return new StremioAddonAdapter(descriptor);
}

function registeredAddon(
  record: AddonStateRecord,
  adapterFactory: PlaybackAddonAdapterFactory,
): RegisteredAddon | null {
  const descriptor = record.descriptor;
  if (!descriptor) return null;
  if (record.installed.sourceType !== 'stremio-manifest') return null;
  if (descriptor.sourceType !== 'stremio-manifest') return null;
  if (!descriptor.manifestUrl) return null;
  if (descriptor.id !== record.installed.addonId) return null;

  try {
    return {
      installed: record.installed,
      adapter: adapterFactory(descriptor),
    };
  } catch {
    return null;
  }
}

export function createPlaybackResolver(
  records: readonly AddonStateRecord[],
  adapterFactory: PlaybackAddonAdapterFactory = defaultAdapterFactory,
): AddonSourceResolver {
  const entries = records
    .map((record) => registeredAddon(record, adapterFactory))
    .filter((entry): entry is RegisteredAddon => entry !== null);

  return new AddonSourceResolver(new AddonRegistry(entries));
}

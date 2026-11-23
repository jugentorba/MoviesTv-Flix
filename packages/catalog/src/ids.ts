import type { CatalogMediaKind } from './types';

export function canonicalMediaId(
  providerId: string,
  kind: CatalogMediaKind,
  externalId: string,
): string {
  return `${providerId.trim().toLowerCase()}:${kind}:${externalId.trim()}`;
}

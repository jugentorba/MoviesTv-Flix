export type OfflineDownloadScope =
  | { type: 'guest' }
  | { type: 'user'; key: string };

function fnv1a(value: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function offlineDownloadScope(
  userId: string | null | undefined,
): OfflineDownloadScope {
  if (userId === null || userId === undefined) {
    return { type: 'guest' };
  }

  const normalized = userId.trim();
  if (
    !normalized
    || normalized.length > 512
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new TypeError('Offline download user id is invalid');
  }

  const first = fnv1a(normalized).toString(36);
  const second = fnv1a(normalized, 0x9e3779b9).toString(36);
  return {
    type: 'user',
    key: `user-${first}-${second}-${normalized.length.toString(36)}`,
  };
}

export function offlineDownloadScopePath(
  scope: OfflineDownloadScope,
): readonly string[] {
  if (scope.type === 'guest') {
    return ['MoviesTv-Flix', 'Downloads'];
  }

  if (
    !scope.key
    || scope.key.length > 128
    || !/^[A-Za-z0-9_-]+$/.test(scope.key)
  ) {
    throw new TypeError('Offline download scope is invalid');
  }

  return [
    'MoviesTv-Flix',
    'Downloads',
    'accounts',
    scope.key,
  ];
}

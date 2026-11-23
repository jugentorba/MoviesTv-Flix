import {
  offlineDownloadScope,
  offlineDownloadScopePath,
} from '../offlineDownloadScope';

test('guest downloads keep the legacy directory for compatibility', () => {
  const scope = offlineDownloadScope(null);
  expect(scope).toEqual({ type: 'guest' });
  expect(offlineDownloadScopePath(scope)).toEqual([
    'MoviesTv-Flix',
    'Downloads',
  ]);
});

test('signed-in users receive stable isolated download directories', () => {
  const first = offlineDownloadScope('user-a');
  const same = offlineDownloadScope(' user-a ');
  const second = offlineDownloadScope('user-b');

  expect(first).toEqual(same);
  expect(first).not.toEqual(second);
  expect(first.type).toBe('user');
  expect(second.type).toBe('user');

  const firstPath = offlineDownloadScopePath(first);
  const secondPath = offlineDownloadScopePath(second);
  expect(firstPath.slice(0, 3)).toEqual([
    'MoviesTv-Flix',
    'Downloads',
    'accounts',
  ]);
  expect(firstPath).not.toEqual(secondPath);
  expect(firstPath).not.toContain('user-a');
  expect(secondPath).not.toContain('user-b');
});

test('only an absent account id can use the guest download scope', () => {
  expect(offlineDownloadScope(undefined)).toEqual({ type: 'guest' });
  expect(() => offlineDownloadScope('   '))
    .toThrow('Offline download user id is invalid');
  expect(() => offlineDownloadScope('x'.repeat(513)))
    .toThrow('Offline download user id is invalid');
  expect(() => offlineDownloadScope('bad\u0000user'))
    .toThrow('Offline download user id is invalid');
});

test('rejects forged or traversal-capable user scope keys', () => {
  expect(() => offlineDownloadScopePath({
    type: 'user',
    key: '../guest',
  })).toThrow('Offline download scope is invalid');
  expect(() => offlineDownloadScopePath({
    type: 'user',
    key: 'x'.repeat(129),
  })).toThrow('Offline download scope is invalid');
});

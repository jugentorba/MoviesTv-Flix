import {
  settingsBackTarget,
  settingsHistoryBackTarget,
} from '../SettingsScreen';

test('settings fallback back target remains safe without history', () => {
  expect(settingsBackTarget('account')).toBe('root');
  expect(settingsBackTarget('stream-providers')).toBe('root');
  expect(settingsBackTarget('audio-languages')).toBe('root');
  expect(settingsBackTarget('downloads')).toBe('library');
  expect(settingsBackTarget('root')).toBe('root');
});

test('settings Back follows the pages that were actually opened', () => {
  const fromDownloads = settingsHistoryBackTarget(
    'downloads',
    ['root', 'library'],
  );
  expect(fromDownloads).toEqual({
    page: 'library',
    history: ['root'],
  });

  const fromLibrary = settingsHistoryBackTarget(
    fromDownloads.page,
    fromDownloads.history,
  );
  expect(fromLibrary).toEqual({
    page: 'root',
    history: [],
  });
});

test('direct Settings shortcuts return to Settings root instead of inventing a parent', () => {
  expect(
    settingsHistoryBackTarget('downloads', ['root']),
  ).toEqual({
    page: 'root',
    history: [],
  });
});

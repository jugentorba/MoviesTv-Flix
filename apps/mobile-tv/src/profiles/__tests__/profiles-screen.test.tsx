import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
} from '@testing-library/react-native';
import { I18nContext } from '../../i18n/useI18n';
import { ProfilesScreen } from '../ProfilesScreen';
import {
  ProfilesContext,
  type AppProfile,
  type ProfilesApi,
} from '../useProfiles';

const mainProfile: AppProfile = {
  id: 'default',
  name: 'Main',
  createdAt: '1970-01-01T00:00:00.000Z',
  useMainProviders: true,
};

function renderProfiles(
  overrides: Partial<ProfilesApi> = {},
) {
  const api: ProfilesApi = {
    profiles: [mainProfile],
    activeProfile: mainProfile,
    ready: true,
    selectProfile: jest.fn(async () => undefined),
    createProfile: jest.fn(async () => null),
    renameProfile: jest.fn(async () => false),
    setAvatar: jest.fn(async () => true),
    setUseMainProviders: jest.fn(async () => false),
    deleteProfile: jest.fn(async () => false),
    ...overrides,
  };

  render(
    <I18nContext.Provider value={{
      locale: 'en',
      direction: 'ltr',
      t: (key) => key,
      formatNumber: String,
      formatDate: String,
      languageName: (tag) => tag,
    }}>
      <ProfilesContext.Provider value={api}>
        <ProfilesScreen onBack={jest.fn()} />
      </ProfilesContext.Provider>
    </I18nContext.Provider>,
  );

  return api;
}

test('creates a secondary profile with optional Main providers', async () => {
  const createProfile = jest.fn(async (
    name: string,
    useMainProviders?: boolean,
  ) => ({
    id: 'kids',
    name,
    createdAt: '2026-10-01T20:00:00.000Z',
    useMainProviders: Boolean(useMainProviders),
  }));
  const api = renderProfiles({ createProfile });

  fireEvent.changeText(
    screen.getByTestId('profile-name-input'),
    'Kids',
  );
  fireEvent.press(
    screen.getByTestId('profile-create-share-providers'),
  );
  fireEvent.press(screen.getByTestId('profile-create'));

  await act(async () => {
    await Promise.resolve();
  });

  expect(api.createProfile).toHaveBeenCalledWith('Kids', true);
});

test('changes provider inheritance without switching profile data', async () => {
  const kids: AppProfile = {
    id: 'kids',
    name: 'Kids',
    createdAt: '2026-10-01T20:00:00.000Z',
    useMainProviders: false,
  };
  const setUseMainProviders = jest.fn(async () => true);
  const api = renderProfiles({
    profiles: [mainProfile, kids],
    activeProfile: kids,
    setUseMainProviders,
  });

  fireEvent.press(
    screen.getByTestId('profile-share-providers-kids'),
  );

  await act(async () => {
    await Promise.resolve();
  });

  expect(api.setUseMainProviders).toHaveBeenCalledWith(
    'kids',
    true,
  );
});

test('switches to another profile from the profile card', async () => {
  const kids: AppProfile = {
    id: 'kids',
    name: 'Kids',
    createdAt: '2026-10-01T20:00:00.000Z',
    useMainProviders: true,
  };
  const selectProfile = jest.fn(async () => undefined);
  const api = renderProfiles({
    profiles: [mainProfile, kids],
    activeProfile: mainProfile,
    selectProfile,
  });

  fireEvent.press(screen.getByTestId('profile-switch-kids'));

  await act(async () => {
    await Promise.resolve();
  });

  expect(api.selectProfile).toHaveBeenCalledWith('kids');
});

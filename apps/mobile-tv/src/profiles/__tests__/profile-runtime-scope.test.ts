import {
  profileLocalIdentity,
  profileRuntimeScope,
} from '../profileRuntimeScope';

test('Main uses the signed-in identity for both data and providers', () => {
  expect(profileRuntimeScope({
    profileId: 'default',
    useMainProviders: true,
    mainIdentity: ' user-main ',
  })).toEqual({
    isMainProfile: true,
    profileIdentity: null,
    dataIdentity: 'user-main',
    providerIdentity: 'user-main',
    promoteMainData: true,
  });
});

test('secondary profile can inherit Main providers without inheriting Main data', () => {
  expect(profileRuntimeScope({
    profileId: 'kids',
    useMainProviders: true,
    mainIdentity: 'user-main',
  })).toEqual({
    isMainProfile: false,
    profileIdentity: 'profile:kids',
    dataIdentity: 'profile:kids',
    providerIdentity: 'user-main',
    promoteMainData: false,
  });
});

test('secondary profile can keep both data and providers isolated', () => {
  expect(profileRuntimeScope({
    profileId: 'guest room',
    useMainProviders: false,
    mainIdentity: 'user-main',
  })).toEqual({
    isMainProfile: false,
    profileIdentity: 'profile:guest%20room',
    dataIdentity: 'profile:guest%20room',
    providerIdentity: 'profile:guest%20room',
    promoteMainData: false,
  });
});

test('Main guest mode stays on the legacy guest storage identity', () => {
  expect(profileRuntimeScope({
    profileId: 'default',
    useMainProviders: true,
    mainIdentity: null,
  })).toEqual({
    isMainProfile: true,
    profileIdentity: null,
    dataIdentity: null,
    providerIdentity: null,
    promoteMainData: true,
  });
});

test('profile local identities are encoded and never collide with Main', () => {
  expect(profileLocalIdentity('default')).toBeNull();
  expect(profileLocalIdentity(' family/kids ')).toBe(
    'profile:family%2Fkids',
  );
});

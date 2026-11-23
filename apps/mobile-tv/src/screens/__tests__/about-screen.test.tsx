import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { APP_RESOURCES } from '../../i18n/resources';
import { translateFrom } from '../../i18n/translate';
import { I18nContext } from '../../i18n/useI18n';
import { AccountContext, type AccountApi } from '../../auth/useAccount';
import { AboutScreen } from '../AboutScreen';

function copy(key: string, locale: keyof typeof APP_RESOURCES = 'en') {
  return translateFrom(APP_RESOURCES[locale], APP_RESOURCES.en, key);
}

const baseAccount: AccountApi = {
  backendAvailable: true,
  userId: null,
  loading: false,
  signIn: jest.fn(),
  signUp: jest.fn(),
  signOut: jest.fn(),
};

function renderScreen(
  account: Partial<AccountApi> = {},
  locale: keyof typeof APP_RESOURCES = 'en',
) {
  return render(
    <I18nContext.Provider
      value={{
        locale,
        direction: 'ltr',
        t: (key: string) => copy(key, locale),
        setLocale: jest.fn(),
      } as never}
    >
      <AccountContext.Provider value={{ ...baseAccount, ...account }}>
        <AboutScreen onBack={jest.fn()} />
      </AccountContext.Provider>
    </I18nContext.Provider>,
  );
}

describe('AboutScreen', () => {
  const original = process.env.EXPO_PUBLIC_SUPABASE_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    else process.env.EXPO_PUBLIC_SUPABASE_URL = original;
  });

  it('shows the version and build the app was built with', () => {
    renderScreen();
    expect(screen.getByText(copy('about.version'))).toBeTruthy();
    expect(screen.getByText(copy('about.build'))).toBeTruthy();
    expect(screen.getByText(copy('about.platform'))).toBeTruthy();
  });

  it('reports a configured backend by host, not by claiming a connection', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://exampleproject.supabase.co';
    renderScreen();
    expect(screen.getByText('exampleproject.supabase.co')).toBeTruthy();
  });

  it('says plainly when no backend is configured', () => {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    renderScreen();
    expect(screen.getByText(copy('about.notConfigured'))).toBeTruthy();
    // The offline copy is the honest one, not the sync promise.
    expect(screen.getByText(copy('about.syncNoteOffline'))).toBeTruthy();
  });

  it('does not promise sync to a guest even when a backend exists', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://exampleproject.supabase.co';
    renderScreen();
    expect(screen.getByText(copy('about.syncNoteSignIn'))).toBeTruthy();
    expect(screen.queryByText(copy('about.syncNote'))).toBeNull();
  });

  it('distinguishes a guest from a signed-in account', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://exampleproject.supabase.co';
    const guest = renderScreen();
    expect(screen.getByText(copy('about.guest'))).toBeTruthy();
    guest.unmount();

    renderScreen({ userId: 'user-1' });
    expect(screen.getByText(copy('about.signedIn'))).toBeTruthy();
  });

  it('never prints the publishable key', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://exampleproject.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_secret_value';
    renderScreen();
    expect(screen.queryByText(/sb_publishable/)).toBeNull();
    delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  });
});

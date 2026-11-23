import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccountContext, type AccountApi } from '../useAccount';
import { AccountScreen } from '../AccountScreen';
import { APP_RESOURCES } from '../../i18n/resources';
import { translateFrom } from '../../i18n/translate';
import { I18nContext } from '../../i18n/useI18n';

function renderAccount(account: AccountApi, locale = 'fr') {
  return render(
    <AccountContext.Provider value={account}>
      <I18nContext.Provider value={{
        locale,
        direction: 'ltr',
        t: (key: string, params?: Record<string, string | number>) => translateFrom(
          APP_RESOURCES[locale as keyof typeof APP_RESOURCES] ?? APP_RESOURCES.en,
          APP_RESOURCES.en,
          key,
          params,
        ),
        formatNumber: String,
        formatDate: String,
        languageName: String,
      }}>
        <AccountScreen onBack={jest.fn()} />
      </I18nContext.Provider>
    </AccountContext.Provider>,
  );
}

function guest(overrides: Partial<AccountApi> = {}): AccountApi {
  return {
    backendAvailable: true,
    userId: null,
    loading: false,
    signIn: jest.fn(async () => undefined),
    signUp: jest.fn(async () => undefined),
    signOut: jest.fn(async () => undefined),
    ...overrides,
  };
}

test('guest can sign in without blocking the rest of the app', () => {
  const account = guest();
  renderAccount(account);

  fireEvent.changeText(screen.getByTestId('account-email'), 'user@example.com');
  fireEvent.changeText(screen.getByTestId('account-password'), 'secret12');
  fireEvent.press(screen.getByTestId('account-sign-in'));

  expect(account.signIn).toHaveBeenCalledWith('user@example.com', 'secret12');
  expect(screen.getByText('Mode invité')).toBeTruthy();
});

test('guest can create an account', () => {
  const account = guest();
  renderAccount(account);

  fireEvent.changeText(screen.getByTestId('account-email'), 'new@example.com');
  fireEvent.changeText(screen.getByTestId('account-password'), 'secret12');
  fireEvent.press(screen.getByTestId('account-sign-up'));

  expect(account.signUp).toHaveBeenCalledWith('new@example.com', 'secret12');
});

test('signed-in account exposes sync status and sign out', () => {
  const account = guest({ userId: 'user-1' });
  renderAccount(account);

  expect(screen.getByText('Connecté')).toBeTruthy();
  expect(screen.getByText('Synchronisation active sur vos appareils')).toBeTruthy();
  fireEvent.press(screen.getByTestId('account-sign-out'));
  expect(account.signOut).toHaveBeenCalledTimes(1);
});

test('localizes first-party account status messages', () => {
  renderAccount(guest({
    message: 'Check your email to confirm your account.',
  }), 'fr');

  expect(
    screen.getByText('Vérifiez votre e-mail pour confirmer votre compte.'),
  ).toBeTruthy();
  expect(
    screen.queryByText('Check your email to confirm your account.'),
  ).toBeNull();
});

test('backend-free PWA keeps sign-in visible while retrying account configuration', () => {
  const retryBackend = jest.fn();
  renderAccount(guest({
    backendAvailable: false,
    retryBackend,
  }));

  expect(screen.getByTestId('account-sign-in-entry')).toBeTruthy();
  expect(screen.getByTestId('account-sign-up-entry')).toBeTruthy();
  expect(screen.queryByTestId('account-email')).toBeNull();

  fireEvent.press(screen.getByTestId('account-sign-in-entry'));

  expect(retryBackend).toHaveBeenCalledTimes(1);
});

test('account configuration retry is disabled while runtime config is loading', () => {
  const retryBackend = jest.fn();
  renderAccount(guest({
    backendAvailable: false,
    loading: true,
    retryBackend,
  }));

  fireEvent.press(screen.getByTestId('account-retry-backend'));

  expect(retryBackend).not.toHaveBeenCalled();
});

test('backend-free build stays usable as guest with a visible account entry point', () => {
  renderAccount(guest({ backendAvailable: false }));

  expect(screen.getByText('Mode invité')).toBeTruthy();
  expect(screen.getByTestId('account-sign-in-entry')).toBeTruthy();
  expect(screen.getByTestId('account-sign-up-entry')).toBeTruthy();
  expect(screen.queryByTestId('account-email')).toBeNull();
});


test('normalizes email casing and whitespace before sign in', () => {
  const account = guest();
  renderAccount(account);
  fireEvent.changeText(screen.getByTestId('account-email'), '  USER@Example.COM  ');
  fireEvent.changeText(screen.getByTestId('account-password'), 'secret12');
  fireEvent.press(screen.getByTestId('account-sign-in'));
  expect(account.signIn).toHaveBeenCalledWith('user@example.com', 'secret12');
});

test('does not submit obviously malformed email addresses', () => {
  const account = guest();
  renderAccount(account);
  fireEvent.changeText(screen.getByTestId('account-email'), 'not-an-email');
  fireEvent.changeText(screen.getByTestId('account-password'), 'secret12');
  fireEvent.press(screen.getByTestId('account-sign-in'));
  expect(account.signIn).not.toHaveBeenCalled();
});


test('does not submit malformed email domain shapes', () => {
  for (const invalidEmail of [
    'user@.com',
    'user@example.',
    'user@example..com',
    'user@-example.com',
    'user@example-.com',
    '.user@example.com',
    'user..name@example.com',
  ]) {
    const account = guest();
    const rendered = renderAccount(account);
    fireEvent.changeText(
      screen.getByTestId('account-email'),
      invalidEmail,
    );
    fireEvent.changeText(
      screen.getByTestId('account-password'),
      'secret12',
    );
    fireEvent.press(screen.getByTestId('account-sign-in'));
    expect(account.signIn).not.toHaveBeenCalled();
    rendered.unmount();
  }
});

test('account form serializes rapid sign-in submissions and clears the password', async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const signIn = jest.fn(async () => pending);
  renderAccount(guest({ signIn }));

  fireEvent.changeText(
    screen.getByTestId('account-email'),
    'user@example.com',
  );
  fireEvent.changeText(
    screen.getByTestId('account-password'),
    'secret12',
  );

  fireEvent.press(screen.getByTestId('account-sign-in'));
  fireEvent.press(screen.getByTestId('account-sign-in'));

  expect(signIn).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('account-sign-in').props.accessibilityState)
    .toEqual({ disabled: true });

  await act(async () => {
    release();
    await pending;
  });

  expect(screen.getByTestId('account-password').props.value).toBe('');
});


test('backend-free PWA can activate sync with public Supabase configuration', () => {
  const configureBackend = jest.fn(async () => true);
  renderAccount(guest({
    backendAvailable: false,
    configureBackend,
  }));

  fireEvent.press(screen.getByTestId('account-advanced-setup'));

  fireEvent.changeText(
    screen.getByTestId('account-backend-url'),
    ' https://example.supabase.co/ ',
  );
  fireEvent.changeText(
    screen.getByTestId('account-backend-key'),
    ' public-key ',
  );
  fireEvent.press(screen.getByTestId('account-configure-backend'));

  expect(configureBackend).toHaveBeenCalledWith(
    'https://example.supabase.co/',
    'public-key',
  );
});

test('manual backend setup stays disabled until both public values are present', () => {
  const configureBackend = jest.fn(async () => true);
  renderAccount(guest({
    backendAvailable: false,
    configureBackend,
  }));

  fireEvent.press(screen.getByTestId('account-advanced-setup'));

  fireEvent.changeText(
    screen.getByTestId('account-backend-url'),
    'https://example.supabase.co',
  );
  fireEvent.press(screen.getByTestId('account-configure-backend'));

  expect(configureBackend).not.toHaveBeenCalled();
  expect(
    screen.getByTestId('account-configure-backend').props.accessibilityState,
  ).toEqual({ disabled: true });
});


test('auth actions stay disabled while backend reset is active', async () => {
  let releaseReset!: () => void;
  const pendingReset = new Promise<void>((resolve) => {
    releaseReset = resolve;
  });
  const signIn = jest.fn(async () => undefined);
  const resetBackend = jest.fn(async () => pendingReset);
  renderAccount(guest({
    backendAvailable: true,
    resetBackend,
    signIn,
  }));

  fireEvent.changeText(
    screen.getByTestId('account-email'),
    'user@example.com',
  );
  fireEvent.changeText(
    screen.getByTestId('account-password'),
    'secret12',
  );
  fireEvent.press(screen.getByTestId('account-reset-backend'));

  expect(
    screen.getByTestId('account-sign-in').props.accessibilityState,
  ).toEqual({ disabled: true });

  fireEvent.press(screen.getByTestId('account-sign-in'));
  expect(signIn).not.toHaveBeenCalled();

  await act(async () => {
    releaseReset();
    await pendingReset;
  });
});


test('saved PWA sync backend can be changed from the account screen', async () => {
  const resetBackend = jest.fn(async () => undefined);
  const signOut = jest.fn(async () => undefined);
  renderAccount(guest({
    backendAvailable: true,
    userId: 'user-1',
    resetBackend,
    signOut,
  }));

  await act(async () => {
    fireEvent.press(screen.getByTestId('account-reset-backend'));
    await Promise.resolve();
  });

  expect(signOut).toHaveBeenCalledTimes(1);
  expect(resetBackend).toHaveBeenCalledTimes(1);
  expect(signOut.mock.invocationCallOrder[0])
    .toBeLessThan(resetBackend.mock.invocationCallOrder[0]!);
});

test('invalid manual backend setup shows a localized error', async () => {
  const configureBackend = jest.fn(async () => false);
  renderAccount(guest({
    backendAvailable: false,
    configureBackend,
  }));

  fireEvent.press(screen.getByTestId('account-advanced-setup'));

  fireEvent.changeText(
    screen.getByTestId('account-backend-url'),
    'https://example.supabase.co',
  );
  fireEvent.changeText(
    screen.getByTestId('account-backend-key'),
    'public-key',
  );

  await act(async () => {
    fireEvent.press(screen.getByTestId('account-configure-backend'));
    await Promise.resolve();
  });

  expect(screen.getByTestId('account-backend-message').props.children)
    .toBe('Vérifiez l’URL Supabase et la clé publique.');
});


test('backend reset still works when sign out cannot reach the old backend', async () => {
  const resetBackend = jest.fn(async () => undefined);
  const signOut = jest.fn(async () => {
    throw new Error('old backend offline');
  });
  renderAccount(guest({
    backendAvailable: true,
    userId: 'user-1',
    resetBackend,
    signOut,
  }));

  await act(async () => {
    fireEvent.press(screen.getByTestId('account-reset-backend'));
    await Promise.resolve();
  });

  expect(signOut).toHaveBeenCalledTimes(1);
  expect(resetBackend).toHaveBeenCalledTimes(1);
});


test('German account screen uses first-party sync copy', () => {
  const account = guest();
  renderAccount(account, 'de');

  expect(screen.getByText('Gastmodus')).toBeTruthy();
  expect(
    screen.getByText('Sie können die App auch ohne Konto verwenden.'),
  ).toBeTruthy();
  expect(screen.getByTestId('account-sign-in').props.children).toBeTruthy();
});

test('forgot password opens the reset form and sends the link', async () => {
  const requestPasswordReset = jest.fn(async () => true);
  const account = guest({ requestPasswordReset });
  renderAccount(account, 'en');

  fireEvent.press(screen.getByTestId('account-forgot-password'));
  fireEvent.changeText(screen.getByTestId('account-email'), 'lost@example.com');
  await act(async () => {
    fireEvent.press(screen.getByTestId('account-reset-send'));
  });

  expect(requestPasswordReset).toHaveBeenCalledWith('lost@example.com');
  expect(screen.getByTestId('account-reset-sent')).toBeTruthy();
});

test('a recovery link asks for a new password and confirms it', async () => {
  const updatePassword = jest.fn(async () => true);
  const finishRecovery = jest.fn();
  const account = guest({
    passwordRecovery: true,
    updatePassword,
    finishRecovery,
  });
  renderAccount(account, 'en');

  fireEvent.changeText(screen.getByTestId('account-new-password'), 'brandnew1');
  fireEvent.changeText(screen.getByTestId('account-confirm-password'), 'brandnew1');
  await act(async () => {
    fireEvent.press(screen.getByTestId('account-save-password'));
  });

  expect(updatePassword).toHaveBeenCalledWith('brandnew1');
  expect(finishRecovery).toHaveBeenCalled();
  expect(screen.getByText('Password updated.')).toBeTruthy();
});

test('a mismatched confirmation never reaches the backend', async () => {
  const updatePassword = jest.fn(async () => true);
  renderAccount(guest({ passwordRecovery: true, updatePassword }), 'en');

  fireEvent.changeText(screen.getByTestId('account-new-password'), 'brandnew1');
  fireEvent.changeText(screen.getByTestId('account-confirm-password'), 'different1');
  await act(async () => {
    fireEvent.press(screen.getByTestId('account-save-password'));
  });

  expect(updatePassword).not.toHaveBeenCalled();
  expect(screen.getByTestId('account-password-error')).toBeTruthy();
});

import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { AuthClient, AuthIdentity } from '@moviestv/auth';

import { useAuthSession } from '../useAuthSession';

function clientWith(overrides: Partial<AuthClient> = {}): AuthClient {
  return {
    restoreSession: async () => null,
    signIn: async () => {
      throw new Error('not used');
    },
    signUp: async () => null,
    signOut: async () => undefined,
    ...overrides,
  };
}

test('sends a reset email with the native redirect', async () => {
  const requestPasswordReset = jest.fn(async () => undefined);
  const client = clientWith({ requestPasswordReset });
  const { result } = renderHook(() => useAuthSession(client));

  await waitFor(() => expect(result.current.loading).toBe(false));
  let sent = false;
  await act(async () => {
    sent = await result.current.requestPasswordReset('lost@example.com');
  });

  expect(sent).toBe(true);
  expect(requestPasswordReset).toHaveBeenCalledWith(
    'lost@example.com',
    'moviestvflix://auth/reset',
  );
});

test('a recovery event opens the set-password state and a new password closes it', async () => {
  let emit: ((identity: AuthIdentity | null, event?: string) => void) | null = null;
  const updatePassword = jest.fn(async () => undefined);
  const client = clientWith({
    subscribe: (listener) => {
      emit = listener;
      return () => undefined;
    },
    updatePassword,
  });
  const { result } = renderHook(() => useAuthSession(client));

  await waitFor(() => expect(result.current.loading).toBe(false));
  act(() => {
    emit?.(null, 'PASSWORD_RECOVERY');
  });
  expect(result.current.passwordRecovery).toBe(true);

  await act(async () => {
    await result.current.updatePassword('brandnew1');
  });
  expect(updatePassword).toHaveBeenCalledWith('brandnew1');
  expect(result.current.passwordRecovery).toBe(false);
});

test('rejects a new password that is too short before calling the backend', async () => {
  const updatePassword = jest.fn(async () => undefined);
  const client = clientWith({ updatePassword });
  const { result } = renderHook(() => useAuthSession(client));

  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => {
    await result.current.updatePassword('123');
  });

  expect(updatePassword).not.toHaveBeenCalled();
});

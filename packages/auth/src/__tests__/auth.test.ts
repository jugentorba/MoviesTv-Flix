import type { AuthClient, AuthSession } from '../AuthClient';
import { AuthController } from '../AuthController';

class FakeAuthClient implements AuthClient {
  constructor(private restored: AuthSession | null = null) {}
  async restoreSession() { return this.restored; }
  async signIn() { return { userId: 'signed-in', accessToken: 'token' }; }
  async signUp() { return null; }
  async signOut() { this.restored = null; }
}

test('restores an existing session', async () => {
  const auth = new AuthController(
    new FakeAuthClient({ userId: 'u1', accessToken: 'token' }),
  );
  await auth.restore();
  expect(auth.getState()).toMatchObject({ status: 'signedIn', session: { userId: 'u1' } });
});

test('failed sign-in keeps a previously restored session until sign-out', async () => {
  const client = new FakeAuthClient({ userId: 'u1', accessToken: 'token' });
  client.signIn = async () => { throw new Error('Wrong password'); };
  const auth = new AuthController(client);
  await auth.restore();
  await auth.signIn('person@example.com', 'wrong-password');
  expect(auth.getState()).toMatchObject({
    status: 'error',
    session: { userId: 'u1' },
    message: 'Wrong password',
  });
  await auth.signOut();
  expect(auth.getState()).toEqual({ status: 'signedOut', session: null });
});


test('redacts credential-bearing authentication errors', async () => {
  const client = new FakeAuthClient();
  client.signIn = async () => {
    throw new Error(
      'POST https://example.supabase.co/auth/v1/token?access_token=LOCAL-SECRET failed',
    );
  };
  const auth = new AuthController(client);

  await auth.signIn('person@example.com', 'password');

  expect(auth.getState()).toMatchObject({
    status: 'error',
    message: 'Authentication failed',
  });
  expect(auth.getState().message).not.toContain('LOCAL-SECRET');
  expect(auth.getState().message).not.toContain('supabase.co');
});



test('redacts encoded and opaque authentication credentials', async () => {
  for (const message of [
    'POST https%3A%2F%2Fexample.supabase.co%2Fauth%2Fv1%2Ftoken failed',
    'refresh_token%3DLOCAL-SECRET expired',
    '/AbCdEfGhIjKlMnOpQrStUvWx12345678/auth failed',
  ]) {
    const client = new FakeAuthClient();
    client.signIn = async () => {
      throw new Error(message);
    };
    const auth = new AuthController(client);

    await auth.signIn('person@example.com', 'password');

    expect(auth.getState()).toMatchObject({
      status: 'error',
      message: 'Authentication failed',
    });
    expect(auth.getState().message).not.toContain('LOCAL-SECRET');
    expect(auth.getState().message).not.toContain('supabase.co');
  }
});

test('redacts session and cookie authentication errors', async () => {
  for (const message of [
    'session=LOCAL-SECRET rejected',
    'Cookie: sb_session=LOCAL-SECRET',
    'Set-Cookie: sb_session=LOCAL-SECRET; Secure',
  ]) {
    const client = new FakeAuthClient();
    client.signIn = async () => {
      throw new Error(message);
    };
    const auth = new AuthController(client);

    await auth.signIn('person@example.com', 'password');

    expect(auth.getState()).toMatchObject({
      status: 'error',
      message: 'Authentication failed',
    });
    expect(auth.getState().message).not.toContain('LOCAL-SECRET');
  }
});

test('ignores stale restore after a newer sign in', async () => {
  let release!: (value: any) => void;
  const restore = new Promise((resolve) => { release = resolve; });
  const client = { restoreSession: jest.fn(() => restore), signIn: jest.fn(async () => ({ userId: 'new', accessToken: 'token' })), signUp: jest.fn(), signOut: jest.fn() } as any;
  const controller = new AuthController(client);
  const restoring = controller.restore();
  await controller.signIn('user@example.com', 'password');
  release({ userId: 'old', accessToken: 'old' });
  await restoring;
  expect(controller.getState().session?.userId).toBe('new');
});

test('rejects invalid credentials before calling auth client', async () => {
  const client = { restoreSession: jest.fn(), signIn: jest.fn(), signUp: jest.fn(), signOut: jest.fn() } as any;
  const controller = new AuthController(client);
  await controller.signIn(' ', '123');
  expect(client.signIn).not.toHaveBeenCalled();
  expect(controller.getState().status).toBe('error');
});


test('normalizes email before controller sign in', async () => {
  const client = { restoreSession: jest.fn(), signIn: jest.fn(async () => ({ userId: 'u', accessToken: 't' })), signUp: jest.fn(), signOut: jest.fn() } as any;
  const controller = new AuthController(client);
  await controller.signIn(' USER@Example.COM ', 'password');
  expect(client.signIn).toHaveBeenCalledWith('user@example.com', 'password');
});


test('rejects malformed restored sessions', async () => {
  const client = { restoreSession: jest.fn(async () => ({ userId: ' ', accessToken: 'token' })), signIn: jest.fn(), signUp: jest.fn(), signOut: jest.fn() } as any;
  const controller = new AuthController(client);
  await controller.restore();
  expect(controller.getState().status).toBe('signedOut');
  expect(controller.getState().session).toBeNull();
});

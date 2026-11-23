import type { AuthClient, AuthSession } from './AuthClient';

function validEmail(email: string): boolean {
  const normalized = email.trim();
  const parts = normalized.split('@');
  return normalized.length <= 320 && !/\s/.test(normalized) && parts.length === 2 && Boolean(parts[0]) && Boolean(parts[1]?.includes('.'));
}

const AUTH_ERROR_FALLBACK = 'Authentication failed';
const AUTH_ERROR_MAX_LENGTH = 240;
const AUTH_ERROR_SENSITIVE_PATTERNS = [
  /https?:\/\/\S+/i,
  /https?%3a%2f%2f\S+/i,
  /\bauthorization\s*[:=]\s*\S+/i,
  /\b(?:set-)?cookie\s*[:=]\s*\S+/i,
  /\bbearer\s+\S+/i,
  /\b(?:access[-_]?token|refresh[-_]?token|auth[-_]?token|api[-_]?key|apikey|key|token|password|passwd|secret|signature|credential|session)\s*[:=]\s*\S+/i,
  /\b(?:access[-_]?token|refresh[-_]?token|auth[-_]?token|api[-_]?key|apikey|key|token|password|passwd|secret|signature|credential|session)%3d\S+/i,
  /\bsb_secret_[A-Za-z0-9_-]+\b/i,
  /\/[A-Za-z0-9_-]{24,}(?:\/|$)/i,
];

function safeAuthErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : '';
  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (
    !normalized
    || AUTH_ERROR_SENSITIVE_PATTERNS.some(
      (pattern) => pattern.test(normalized),
    )
  ) {
    return AUTH_ERROR_FALLBACK;
  }
  return normalized.length <= AUTH_ERROR_MAX_LENGTH
    ? normalized
    : `${normalized.slice(0, AUTH_ERROR_MAX_LENGTH - 1)}…`;
}

export type AuthState = Readonly<{
  status: 'restoring' | 'signedOut' | 'signedIn' | 'error';
  session: AuthSession | null;
  message?: string;
}>;

export class AuthController {
  private state: AuthState = Object.freeze({ status: 'restoring', session: null });

  private generation = 0;

  constructor(private readonly client: AuthClient) {}

  getState(): AuthState {
    return this.state;
  }

  async restore(): Promise<void> {
    const generation = ++this.generation;
    try {
      const session = await this.client.restoreSession();
      if (generation !== this.generation) return;
      const valid = session && session.userId?.trim() && session.accessToken?.trim();
      this.setState(valid ? { status: 'signedIn', session: { ...session!, userId: session!.userId.trim(), accessToken: session!.accessToken.trim() } } : { status: 'signedOut', session: null });
    } catch (error) {
      if (generation === this.generation) this.setError(error);
    }
  }

  async signIn(email: string, password: string): Promise<void> {
    if (!validEmail(email) || password.length < 6 || password.length > 1024) { this.setState({ status: 'error', session: this.state.session, message: 'Invalid email or password' }); return; }
    const generation = ++this.generation;
    try {
      const session = await this.client.signIn(email.trim().toLowerCase(), password);
      if (generation !== this.generation) return;
      if (!session?.userId?.trim() || !session.accessToken?.trim()) throw new Error('Authentication session was not returned');
      this.setState({ status: 'signedIn', session: { ...session, userId: session.userId.trim(), accessToken: session.accessToken.trim() } });
    } catch (error) {
      if (generation === this.generation) this.setError(error);
    }
  }

  async signUp(email: string, password: string): Promise<void> {
    if (!validEmail(email) || password.length < 6 || password.length > 1024) { this.setState({ status: 'error', session: this.state.session, message: 'Invalid email or password' }); return; }
    const generation = ++this.generation;
    try {
      const session = await this.client.signUp(email.trim().toLowerCase(), password);
      if (generation !== this.generation) return;
      const valid = session && session.userId?.trim() && session.accessToken?.trim();
      this.setState(valid ? { status: 'signedIn', session: { ...session!, userId: session!.userId.trim(), accessToken: session!.accessToken.trim() } } : { status: 'signedOut', session: null });
    } catch (error) {
      if (generation === this.generation) this.setError(error);
    }
  }

  async signOut(): Promise<void> {
    const generation = ++this.generation;
    try {
      await this.client.signOut();
      if (generation !== this.generation) return;
      this.setState({ status: 'signedOut', session: null });
    } catch (error) {
      if (generation === this.generation) this.setError(error);
    }
  }

  private setError(error: unknown): void {
    this.setState({
      status: 'error',
      session: this.state.session,
      message: safeAuthErrorMessage(error),
    });
  }

  private setState(state: AuthState): void {
    this.state = Object.freeze({ ...state });
  }
}

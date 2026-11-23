import React, { useContext, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { type Theme, fontFamily } from '@moviestv/ui';
import { useI18n } from '../i18n/useI18n';
import { IconBackButton } from '../components/IconBackButton';
import { useSwipeBack } from '../components/useSwipeBack';
import { safeInsetEdge } from '../app/safeAreaLayout';
import { useAccount } from './useAccount';
import { maskEmail } from './maskEmail';
import { passwordProblem, signInPasswordValid } from './passwordPolicy';
import { markWelcomeSeen } from './firstRun';
import { useTheme, useThemeStyles } from '../theme/ThemeProvider';

function localizedAccountMessage(
  message: string | undefined,
  t: (key: string) => string,
): string | undefined {
  if (!message) return undefined;
  // Supabase returns this exact string for an unknown email and for a wrong
  // password. Saying so, and pointing at "Create account", is the difference
  // between a dead end and a next step.
  if (message === 'Invalid email or password.' || message === 'Invalid login credentials') {
    return t('account.invalidCredentials');
  }
  if (/already registered|already been registered/i.test(message)) {
    return t('account.alreadyRegistered');
  }
  if (message === 'Check your email to confirm your account.') {
    return t('account.confirmEmail');
  }
  if (message === 'Authentication failed') {
    return t('account.authFailed');
  }
  return message;
}

function ActionButton({
  label,
  onPress,
  primary = false,
  disabled = false,
  testID,
}: {
  label: string;
  onPress(): void;
  primary?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  const styles = useThemeStyles(createStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      testID={testID}
      onPress={onPress}
      style={({ focused, pressed }) => [
        styles.button,
        primary && styles.buttonPrimary,
        disabled && styles.disabled,
        focused && !disabled && styles.focused,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, primary && styles.buttonTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

function validAccountEmail(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (
    !normalized
    || normalized.length > 320
    || /[\s\u0000-\u001f\u007f]/.test(normalized)
  ) return false;

  const at = normalized.indexOf('@');
  if (
    at <= 0
    || at !== normalized.lastIndexOf('@')
  ) return false;

  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  if (
    !local
    || local.length > 64
    || local.startsWith('.')
    || local.endsWith('.')
    || local.includes('..')
  ) return false;

  const labels = domain.split('.');
  if (labels.length < 2 || domain.length > 255) return false;
  return labels.every((label) => (
    label.length > 0
    && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
  ));
}

export function AccountScreen({ onBack }: { onBack(): void }) {
  const styles = useThemeStyles(createStyles);
  const theme = useTheme();
  const account = useAccount();
  const { direction, t } = useI18n();
  const swipeHandlers = useSwipeBack(onBack);
  const accountMessage = localizedAccountMessage(account.message, t);
  const safeAreaInsets = useContext(SafeAreaInsetsContext) ?? {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [backendUrl, setBackendUrl] = useState('');
  const [backendKey, setBackendKey] = useState('');
  const [backendMessage, setBackendMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [showAdvancedSetup, setShowAdvancedSetup] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'signIn' | 'signUp' | null>(null);
  const [mode, setMode] = useState<'signIn' | 'signUp' | 'reset'>('signIn');
  const [resetSent, setResetSent] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordUpdated, setPasswordUpdated] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [changeError, setChangeError] = useState<string | null>(null);
  const [changeDone, setChangeDone] = useState(false);
  const [signOutArmed, setSignOutArmed] = useState(false);
  const normalizedEmail = email.trim().toLowerCase();
  // The buttons stay tappable; the requirement is explained on press instead of
  // the control refusing silently, which is what made "Create account" look dead.
  const canSubmit = !account.loading && !submitting && !configuring;
  const policyMessage = (): string | null => {
    const problem = passwordProblem(password);
    if (!problem) return null;
    if (problem === 'too-short') return t('account.passwordTooShort');
    if (problem === 'too-long') return t('account.passwordTooLong');
    if (problem === 'needs-letter') return t('account.passwordNeedsLetter');
    return t('account.passwordNeedsNumber');
  };
  const validate = (policy: 'signIn' | 'create'): string | null => {
    if (!validAccountEmail(normalizedEmail)) return t('account.emailInvalid');
    if (policy === 'signIn') {
      return signInPasswordValid(password) ? null : t('account.passwordTooShort');
    }
    return policyMessage();
  };
  React.useEffect(() => {
    if (account.userId?.trim()) void markWelcomeSeen();
  }, [account.userId]);

  const clearCredentials = () => {
    setEmail('');
    setPassword('');
  };
  const canConfigureBackend = Boolean(
    account.configureBackend
    && backendUrl.trim()
    && backendKey.trim()
    && !account.loading
    && !configuring
  );
  const submitBackend = async () => {
    if (!canConfigureBackend || !account.configureBackend) return;
    setConfiguring(true);
    setBackendMessage('');
    try {
      const configured = await account.configureBackend(
        backendUrl.trim(),
        backendKey.trim(),
      );
      if (configured) {
        setBackendUrl('');
        setBackendKey('');
      } else {
        setBackendMessage(t('account.invalidBackend'));
      }
    } catch {
      setBackendMessage(t('account.invalidBackend'));
    } finally {
      setConfiguring(false);
    }
  };
  const resetBackend = async () => {
    if (!account.resetBackend || account.loading || submitting || configuring) {
      return;
    }
    setConfiguring(true);
    try {
      if (account.userId?.trim()) {
        try {
          await account.signOut();
        } catch {
          // A dead or misconfigured backend must not trap the user on it.
        }
      }
      await account.resetBackend();
      clearCredentials();
      setBackendMessage('');
    } finally {
      setConfiguring(false);
    }
  };
  const submitSignIn = async () => {
    if (!canSubmit) return;
    const problem = validate('signIn');
    setFormError(problem);
    if (problem) return;
    setSubmitting(true);
    setBusyAction('signIn');
    try {
      await account.signIn(normalizedEmail, password);
    } finally {
      setPassword('');
      setSubmitting(false);
      setBusyAction(null);
    }
  };
  const submitSignUp = async () => {
    if (!canSubmit) return;
    const problem = validate('create');
    setFormError(problem);
    if (problem) return;
    setSubmitting(true);
    setBusyAction('signUp');
    try {
      await account.signUp(normalizedEmail, password);
    } finally {
      setPassword('');
      setSubmitting(false);
      setBusyAction(null);
    }
  };

  const submitChangePassword = async () => {
    if (!canSubmit) return;
    if (!signInPasswordValid(currentPassword)) {
      setChangeError(t('account.currentPassword'));
      return;
    }
    const policy = policyMessage();
    if (policy) {
      setChangeError(policy);
      return;
    }
    if (password !== confirmPassword) {
      setChangeError(t('account.passwordMismatch'));
      return;
    }
    setChangeError(null);
    setChangeDone(false);
    setSubmitting(true);
    try {
      const changed = await account.changePassword?.(currentPassword, password) ?? false;
      if (changed) {
        setChangeDone(true);
        setCurrentPassword('');
        setPassword('');
        setConfirmPassword('');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const submitReset = async () => {
    if (!canSubmit) return;
    if (!validAccountEmail(normalizedEmail)) {
      setFormError(t('account.emailInvalid'));
      return;
    }
    setFormError(null);
    setResetSent(false);
    setSubmitting(true);
    try {
      const sent = await account.requestPasswordReset?.(normalizedEmail) ?? false;
      if (sent) {
        setResetSent(true);
        setPassword('');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const submitNewPassword = async () => {
    if (!canSubmit) return;
    const policy = policyMessage();
    if (policy) {
      setPasswordError(policy);
      return;
    }
    if (password !== confirmPassword) {
      setPasswordError(t('account.passwordMismatch'));
      return;
    }
    setPasswordError(null);
    setSubmitting(true);
    try {
      const updated = await account.updatePassword?.(password) ?? false;
      if (updated) {
        setPasswordUpdated(true);
        setPassword('');
        setConfirmPassword('');
        account.finishRecovery?.();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView
      testID="account-screen"
      {...swipeHandlers}
      style={styles.scroll}
      contentContainerStyle={[
        styles.screen,
        {
          direction,
          paddingTop: safeInsetEdge(
            theme.spacing.lg,
            safeAreaInsets.top,
            12,
          ),
          paddingRight: safeInsetEdge(
            theme.spacing.lg,
            safeAreaInsets.right,
            12,
          ),
          paddingBottom: safeInsetEdge(
            theme.spacing.lg,
            safeAreaInsets.bottom,
            12,
          ),
          paddingLeft: safeInsetEdge(
            theme.spacing.lg,
            safeAreaInsets.left,
            12,
          ),
        },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.header, { flexDirection: direction === 'rtl' ? 'row-reverse' : 'row' }]}>
        <IconBackButton label={t('common.back')} onPress={onBack} testID="account-back" />
        <Text style={[styles.title, { writingDirection: direction }]}>{t('account.title')}</Text>
      </View>

      <View style={styles.statusCard}>
        <Text style={[styles.statusTitle, { writingDirection: direction }]}>
          {account.userId?.trim() ? t('account.signedIn') : t('account.guest')}
        </Text>
        <Text style={[styles.statusBody, { writingDirection: direction }]}>
          {account.userId?.trim()
            ? t('account.syncActive')
            : account.backendAvailable
              ? t('account.keepGuest')
              : t('account.backendMissing')}
        </Text>
        {account.userId?.trim() ? (
          <Text numberOfLines={1} style={styles.userId}>
            {maskEmail(account.email) ?? account.userId.trim()}
          </Text>
        ) : (
          <ActionButton
            label={t('account.continueAsGuest')}
            testID="account-continue-guest"
            onPress={() => {
              void markWelcomeSeen();
              onBack();
            }}
          />
        )}
      </View>

      {account.loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      ) : null}

      {accountMessage ? (
        <Text accessibilityRole="alert" style={[styles.message, { writingDirection: direction }]}>
          {accountMessage}
        </Text>
      ) : null}

      {!account.backendAvailable ? (
        <View style={styles.form} testID="account-access-unavailable">
          <View style={styles.actions}>
            <ActionButton
              label={t('account.signIn')}
              primary
              disabled={account.loading || configuring}
              testID="account-sign-in-entry"
              onPress={() => {
                account.retryBackend?.();
                setShowAdvancedSetup(true);
              }}
            />
            <ActionButton
              label={t('account.create')}
              disabled={account.loading || configuring}
              testID="account-sign-up-entry"
              onPress={() => {
                account.retryBackend?.();
                setShowAdvancedSetup(true);
              }}
            />
          </View>
          {account.retryBackend ? (
            <ActionButton
              label={t('account.retryBackend')}
              onPress={account.retryBackend}
              disabled={account.loading || configuring}
              testID="account-retry-backend"
            />
          ) : null}
          {account.configureBackend ? (
            <ActionButton
              label={t('account.manualSetup')}
              onPress={() => setShowAdvancedSetup((value) => !value)}
              disabled={account.loading || configuring}
              testID="account-advanced-setup"
            />
          ) : null}
        </View>
      ) : null}

      {!account.backendAvailable && account.configureBackend && showAdvancedSetup ? (
        <View style={styles.form} testID="account-backend-setup">
          <Text style={[styles.formTitle, { writingDirection: direction }]}>
            {t('account.manualSetup')}
          </Text>
          <TextInput
            testID="account-backend-url"
            accessibilityLabel={t('account.supabaseUrl')}
            value={backendUrl}
            onChangeText={(value) => {
              setBackendUrl(value.replace(/[\r\n\t]/g, ''));
              setBackendMessage('');
            }}
            placeholder={t('account.supabaseUrl')}
            placeholderTextColor={theme.colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            maxLength={2048}
            style={[styles.input, { textAlign: direction === 'rtl' ? 'right' : 'left' }]}
          />
          <TextInput
            testID="account-backend-key"
            accessibilityLabel={t('account.publishableKey')}
            value={backendKey}
            onChangeText={(value) => {
              setBackendKey(value.replace(/[\r\n\t]/g, '').slice(0, 8192));
              setBackendMessage('');
            }}
            placeholder={t('account.publishableKey')}
            placeholderTextColor={theme.colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={8192}
            style={[styles.input, { textAlign: direction === 'rtl' ? 'right' : 'left' }]}
          />
          <ActionButton
            label={t('account.connectBackend')}
            primary
            disabled={!canConfigureBackend}
            testID="account-configure-backend"
            onPress={() => { void submitBackend(); }}
          />
          {backendMessage ? (
            <Text
              accessibilityRole="alert"
              testID="account-backend-message"
              style={[styles.message, { writingDirection: direction }]}
            >
              {backendMessage}
            </Text>
          ) : null}
        </View>
      ) : null}

      {account.userId?.trim() ? (
        <View style={styles.form} testID="account-signed-in">
          <ActionButton
            label={t('account.signOut')}
            onPress={() => { clearCredentials(); void account.signOut(); }}
            disabled={account.loading}
            testID="account-sign-out"
          />
          {account.changePassword ? (
            changeOpen ? (
              <View style={styles.form} testID="account-change-password">
                <Text style={styles.formTitle}>{t('account.changePasswordTitle')}</Text>
                <TextInput
                  testID="account-current-password"
                  accessibilityLabel={t('account.currentPassword')}
                  value={currentPassword}
                  onChangeText={(value) => setCurrentPassword(value.slice(0, 1024))}
                  placeholder={t('account.currentPassword')}
                  placeholderTextColor={theme.colors.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="current-password"
                  textContentType="password"
                  maxLength={1024}
                  secureTextEntry
                  style={[styles.input, { textAlign: direction === 'rtl' ? 'right' : 'left' }]}
                />
                <TextInput
                  testID="account-change-password-new"
                  accessibilityLabel={t('account.password')}
                  value={password}
                  onChangeText={(value) => setPassword(value.slice(0, 1024))}
                  placeholder={t('account.password')}
                  placeholderTextColor={theme.colors.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="new-password"
                  textContentType="newPassword"
                  maxLength={1024}
                  secureTextEntry
                  style={[styles.input, { textAlign: direction === 'rtl' ? 'right' : 'left' }]}
                />
                <TextInput
                  testID="account-change-password-confirm"
                  accessibilityLabel={t('account.newPasswordConfirm')}
                  value={confirmPassword}
                  onChangeText={(value) => setConfirmPassword(value.slice(0, 1024))}
                  placeholder={t('account.newPasswordConfirm')}
                  placeholderTextColor={theme.colors.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="new-password"
                  textContentType="newPassword"
                  maxLength={1024}
                  secureTextEntry
                  style={[styles.input, { textAlign: direction === 'rtl' ? 'right' : 'left' }]}
                />
                <Text style={[styles.hint, { writingDirection: direction }]}>
                  {t('account.passwordHint')}
                </Text>
                {changeError ? (
                  <Text accessibilityRole="alert" testID="account-change-password-error" style={styles.fieldError}>
                    {changeError}
                  </Text>
                ) : null}
                {changeDone ? (
                  <Text testID="account-change-password-done" style={[styles.message, { writingDirection: direction }]}>
                    {t('account.passwordChanged')}
                  </Text>
                ) : null}
                <ActionButton
                  label={t('account.changePasswordAction')}
                  primary
                  disabled={!canSubmit}
                  testID="account-change-password-save"
                  onPress={() => { void submitChangePassword(); }}
                />
                <ActionButton
                  label={t('account.backToSignIn')}
                  testID="account-change-password-cancel"
                  onPress={() => {
                    setChangeOpen(false);
                    setChangeError(null);
                    setCurrentPassword('');
                    setPassword('');
                    setConfirmPassword('');
                  }}
                />
              </View>
            ) : (
              <ActionButton
                label={t('account.changePasswordTitle')}
                testID="account-change-password-open"
                onPress={() => { setChangeOpen(true); setChangeDone(false); }}
                disabled={account.loading}
              />
            )
          ) : null}
          {account.signOutEverywhere ? (
            <ActionButton
              label={signOutArmed
                ? t('account.signOutEverywhereConfirm')
                : t('account.signOutEverywhere')}
              testID="account-sign-out-everywhere"
              disabled={account.loading}
              onPress={() => {
                if (!signOutArmed) {
                  setSignOutArmed(true);
                  return;
                }
                setSignOutArmed(false);
                void account.signOutEverywhere?.();
              }}
            />
          ) : null}
        </View>
      ) : account.backendAvailable ? (
        <View style={styles.form}>
          {account.passwordRecovery ? (
            <View style={styles.form} testID="account-recovery">
              <Text style={styles.formTitle}>{t('account.newPasswordTitle')}</Text>
              <Text style={styles.statusBody}>{t('account.newPasswordIntro')}</Text>
              <TextInput
                testID="account-new-password"
                accessibilityLabel={t('account.password')}
                value={password}
                onChangeText={(value) => setPassword(value.slice(0, 1024))}
                placeholder={t('account.password')}
                placeholderTextColor={theme.colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="new-password"
                textContentType="newPassword"
                maxLength={1024}
                secureTextEntry
                style={[styles.input, { textAlign: direction === 'rtl' ? 'right' : 'left' }]}
              />
              <TextInput
                testID="account-confirm-password"
                accessibilityLabel={t('account.newPasswordConfirm')}
                value={confirmPassword}
                onChangeText={(value) => setConfirmPassword(value.slice(0, 1024))}
                placeholder={t('account.newPasswordConfirm')}
                placeholderTextColor={theme.colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="new-password"
                textContentType="newPassword"
                maxLength={1024}
                secureTextEntry
                style={[styles.input, { textAlign: direction === 'rtl' ? 'right' : 'left' }]}
              />
              <Text style={[styles.hint, { writingDirection: direction }]}>
                {t('account.passwordHint')}
              </Text>
              {passwordError ? (
                <Text accessibilityRole="alert" testID="account-password-error" style={styles.fieldError}>
                  {passwordError}
                </Text>
              ) : null}
              {passwordUpdated ? (
                <Text style={[styles.message, { writingDirection: direction }]}>
                  {t('account.passwordUpdated')}
                </Text>
              ) : null}
              <ActionButton
                label={t('account.savePassword')}
                primary
                disabled={!canSubmit}
                testID="account-save-password"
                onPress={() => { void submitNewPassword(); }}
              />
            </View>
          ) : mode === 'reset' ? (
            <View style={styles.form} testID="account-reset">
              <Text style={styles.formTitle}>{t('account.resetTitle')}</Text>
              <Text style={styles.statusBody}>{t('account.resetIntro')}</Text>
              <TextInput
                testID="account-email"
                accessibilityLabel={t('account.email')}
                value={email}
                onChangeText={(value) => setEmail(value.replace(/[\r\n\t]/g, ''))}
                placeholder={t('account.email')}
                placeholderTextColor={theme.colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                maxLength={320}
                keyboardType="email-address"
                style={[styles.input, { textAlign: direction === 'rtl' ? 'right' : 'left' }]}
              />
              {resetSent ? (
                <Text testID="account-reset-sent" style={[styles.message, { writingDirection: direction }]}>
                  {t('account.resetSent')}
                </Text>
              ) : null}
              {formError ? (
                <Text accessibilityRole="alert" testID="account-form-error" style={styles.fieldError}>
                  {formError}
                </Text>
              ) : null}
              <ActionButton
                label={t('account.resetSend')}
                primary
                disabled={!canSubmit}
                testID="account-reset-send"
                onPress={() => { void submitReset(); }}
              />
              <ActionButton
                label={t('account.backToSignIn')}
                testID="account-reset-back"
                onPress={() => {
                  setMode('signIn');
                  setResetSent(false);
                  setFormError(null);
                }}
              />
            </View>
          ) : (
          <>
          <TextInput
            testID="account-email"
            accessibilityLabel={t('account.email')}
            value={email}
            onChangeText={(value) => setEmail(value.replace(/[\r\n\t]/g, ''))}
            placeholder={t('account.email')}
            placeholderTextColor={theme.colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            maxLength={320}
            keyboardType="email-address"
            style={[styles.input, { textAlign: direction === 'rtl' ? 'right' : 'left' }]}
          />
          <TextInput
            testID="account-password"
            accessibilityLabel={t('account.password')}
            value={password}
            onChangeText={(value) => setPassword(value.slice(0, 1024))}
            placeholder={t('account.password')}
            placeholderTextColor={theme.colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="password"
            textContentType="password"
            maxLength={1024}
            secureTextEntry
            returnKeyType="done"
            onSubmitEditing={() => { if (canSubmit) void submitSignIn(); }}
            style={[styles.input, { textAlign: direction === 'rtl' ? 'right' : 'left' }]}
          />
          <Text style={[styles.hint, { writingDirection: direction }]}>
            {t('account.passwordHint')}
          </Text>
          {formError ? (
            <Text accessibilityRole="alert" testID="account-form-error" style={styles.fieldError}>
              {formError}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <ActionButton
              label={busyAction === 'signIn' ? t('account.signingIn') : t('account.signIn')}
              primary
              disabled={!canSubmit}
              testID="account-sign-in"
              onPress={() => { void submitSignIn(); }}
            />
            <ActionButton
              label={busyAction === 'signUp' ? t('account.creating') : t('account.create')}
              disabled={!canSubmit}
              testID="account-sign-up"
              onPress={() => { void submitSignUp(); }}
            />
          </View>
          {account.requestPasswordReset ? (
            <Pressable
              accessibilityRole="button"
              testID="account-forgot-password"
              onPress={() => {
                setMode('reset');
                setResetSent(false);
                setFormError(null);
                setPassword('');
              }}
              style={({ pressed }) => [styles.forgot, pressed && styles.pressed]}
            >
              <Text style={[styles.forgotText, { writingDirection: direction }]}>
                {t('account.forgotPassword')}
              </Text>
            </Pressable>
          ) : null}
          </>
          )}
        </View>
      ) : null}

      {account.backendAvailable && account.resetBackend ? (
        <ActionButton
          label={t('account.changeBackend')}
          onPress={() => { void resetBackend(); }}
          disabled={account.loading || submitting || configuring}
          testID="account-reset-backend"
        />
      ) : null}
    </ScrollView>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  screen: {
    flexGrow: 1,
    gap: theme.spacing.lg,
    backgroundColor: theme.colors.background,
    padding: theme.spacing.lg,
  },
  header: { alignItems: 'center', gap: theme.spacing.md },
  title: { flex: 1, color: theme.colors.text, fontSize: 30, fontWeight: '900' },
  statusCard: {
    gap: 7,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
  },
  statusTitle: { color: theme.colors.text, fontSize: 20, fontWeight: '900' },
  statusBody: { color: theme.colors.muted, fontSize: 14, lineHeight: 21 },
  userId: { color: theme.colors.muted, fontSize: 10, marginTop: 4 },
  form: { gap: theme.spacing.md },
  hint: { color: theme.colors.subtle, fontSize: 11, lineHeight: 16 },
  forgot: { alignSelf: 'flex-start', paddingVertical: 6 },
  forgotText: { color: theme.colors.accentSoft, fontSize: 13, fontWeight: '600' },
  formTitle: { color: theme.colors.text, fontSize: 15, fontWeight: '800' },
  input: {
    minHeight: 52,
    paddingHorizontal: theme.spacing.md,
    color: theme.colors.text,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    fontSize: 16,
  },
  fieldError: {
    color: theme.colors.warning,
    fontFamily: fontFamily.ui,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  button: {
    minHeight: 44,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 17,
    paddingVertical: 10,
  },
  buttonPrimary: { backgroundColor: '#ffffff', borderColor: '#ffffff' },
  buttonText: { color: theme.colors.text, fontSize: 13, fontWeight: '900' },
  buttonTextPrimary: { color: '#09090b' },
  focused: { borderColor: theme.colors.focus },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.4 },
  loading: { alignItems: 'flex-start' },
  message: { color: theme.colors.accentSoft, fontSize: 13, lineHeight: 19 },
});

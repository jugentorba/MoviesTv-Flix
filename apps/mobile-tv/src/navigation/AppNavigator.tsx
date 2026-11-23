import React from 'react';
import { useContext } from 'react';
import { AccountContext } from '../auth/useAccount';
import { useFirstRunWelcome } from '../auth/firstRun';
import { ProfilesContext } from '../profiles/useProfiles';
import type { FormFactor } from '../app/platform';
import type { SettingsPage } from '../screens/SettingsScreen';
import { PhoneTabs } from './PhoneTabs';
import { TVRail } from './TVRail';

export interface SettingsNavigationRequest {
  id: number;
  page: SettingsPage;
}

export function AppNavigator({
  formFactor,
  settingsRequest,
  onSettingsRequestHandled,
}: {
  formFactor: FormFactor;
  settingsRequest?: SettingsNavigationRequest | null;
  onSettingsRequestHandled?(id: number): void;
}) {
  // Contexts are read directly rather than through the hooks: the navigator is
  // rendered in isolation by tests, and a missing provider must not throw.
  const account = useContext(AccountContext);
  const profiles = useContext(ProfilesContext);
  const firstRun = useFirstRunWelcome(account?.userId ?? null, profiles?.ready ?? true);

  if (formFactor === 'phone') {
    return (
      <PhoneTabs
        settingsRequest={settingsRequest}
        onSettingsRequestHandled={onSettingsRequestHandled}
        openAccountFirst={firstRun}
      />
    );
  }

  return (
    <TVRail
      variant={formFactor === 'tv' ? 'tv' : 'wide'}
      settingsRequest={settingsRequest}
      onSettingsRequestHandled={onSettingsRequestHandled}
    />
  );
}

import React, { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { type Theme } from '@moviestv/ui';
import { PROFILE_AVATARS, avatarFor } from './avatars';
import { useI18n } from '../i18n/useI18n';
import { DEFAULT_PROFILE_ID, useProfiles } from './useProfiles';
import { useTheme, useThemeStyles } from '../theme/ThemeProvider';
import { SettingsPage } from '../components/SettingsPage';

function copyFor(t: (key: string) => string) {
  return {
    back: t('profilesScreen.back'),
    title: t('profilesScreen.title'),
    subtitle: t('profilesScreen.subtitle'),
    active: t('profilesScreen.active'),
    main: t('profilesScreen.main'),
    profile: t('profilesScreen.profile'),
    switch: t('profilesScreen.switch'),
    delete: t('profilesScreen.delete'),
    useMain: t('profilesScreen.useMain'),
    sharedDetail: t('profilesScreen.sharedDetail'),
    separateDetail: t('profilesScreen.separateDetail'),
    mainDetail: t('profilesScreen.mainDetail'),
    add: t('profilesScreen.add'),
    name: t('profilesScreen.name'),
    create: t('profilesScreen.create'),
    createSharedDetail: t('profilesScreen.createSharedDetail'),
    limit: t('profilesScreen.limit'),
  };
}

function Button({
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
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={({ focused, pressed }) => [
        styles.button,
        primary && styles.buttonPrimary,
        disabled && styles.disabled,
        focused && !disabled && styles.focused,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, primary && styles.buttonTextPrimary]}>
        {label}
      </Text>
    </Pressable>
  );
}

function Toggle({
  label,
  detail,
  value,
  direction,
  testID,
  onChange,
}: {
  label: string;
  detail: string;
  value: boolean;
  direction: 'ltr' | 'rtl';
  testID?: string;
  onChange(value: boolean): void;
}) {
  const styles = useThemeStyles(createStyles);
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      testID={testID}
      onPress={() => onChange(!value)}
      style={({ focused, pressed }) => [
        styles.toggleRow,
        { flexDirection: direction === 'rtl' ? 'row-reverse' : 'row' },
        focused && styles.focused,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.toggleCopy}>
        <Text style={[styles.toggleLabel, { writingDirection: direction }]}>
          {label}
        </Text>
        <Text style={[styles.toggleDetail, { writingDirection: direction }]}>
          {detail}
        </Text>
      </View>
      <View style={[styles.switchTrack, value && styles.switchTrackOn]}>
        <View style={[styles.switchKnob, value && styles.switchKnobOn]} />
      </View>
    </Pressable>
  );
}

export function ProfilesScreen({ onBack }: { onBack(): void }) {
  const styles = useThemeStyles(createStyles);
  const theme = useTheme();
  const profiles = useProfiles();
  const { t, direction } = useI18n();
  const copy = copyFor(t);
  const [name, setName] = useState('');
  const [newProfileUsesMainProviders, setNewProfileUsesMainProviders] = useState(false);

  const create = async () => {
    const created = await profiles.createProfile(
      name,
      newProfileUsesMainProviders,
    );
    if (created) {
      setName('');
      setNewProfileUsesMainProviders(false);
    }
  };

  return (
    <SettingsPage
      testID="profiles-screen"
      eyebrow={t('profilesScreen.eyebrow')}
      title={copy.title}
      intro={copy.subtitle}
      backLabel={copy.back}
      onBack={onBack}
      closeLabel={copy.back}
      onClose={onBack}
    >

      <View style={styles.list}>
        {profiles.profiles.map((profile) => {
          const active = profile.id === profiles.activeProfile.id;
          const main = profile.id === DEFAULT_PROFILE_ID;
          return (
            <View
              key={profile.id}
              testID={`profile-card-${profile.id}`}
              style={[styles.profile, active && styles.profileActive]}
            >
              <View
                style={[
                  styles.profileTopRow,
                  { flexDirection: direction === 'rtl' ? 'row-reverse' : 'row' },
                ]}
              >
                <View
                  style={[
                    styles.avatar,
                    active && styles.avatarActive,
                    { backgroundColor: avatarFor(profile.avatarId).color },
                  ]}
                >
                  <Ionicons name={avatarFor(profile.avatarId).icon} size={22} color="#0b0b0f" />
                </View>
                <View style={styles.profileCopy}>
                  <Text style={[styles.profileName, { writingDirection: direction }]}>
                    {profile.name}
                  </Text>
                  <Text style={[styles.profileMeta, { writingDirection: direction }]}>
                    {active ? copy.active : main ? copy.main : copy.profile}
                  </Text>
                </View>
                {!active ? (
                  <Button
                    label={copy.switch}
                    primary
                    testID={`profile-switch-${profile.id}`}
                    onPress={() => { void profiles.selectProfile(profile.id); }}
                  />
                ) : null}
                {!main ? (
                  <Button
                    label={copy.delete}
                    testID={`profile-delete-${profile.id}`}
                    onPress={() => { void profiles.deleteProfile(profile.id); }}
                  />
                ) : null}
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.avatarPicker}
                testID={`profile-avatars-${profile.id}`}
              >
                {PROFILE_AVATARS.map((choice) => {
                  const chosen = avatarFor(profile.avatarId).id === choice.id;
                  return (
                    <Pressable
                      key={choice.id}
                      testID={`profile-avatar-${profile.id}-${choice.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={choice.id}
                      onPress={() => { void profiles.setAvatar(profile.id, choice.id); }}
                      style={[styles.avatarChoice, { backgroundColor: choice.color }, chosen && styles.avatarChoiceOn]}
                    >
                      <Ionicons name={choice.icon} size={18} color="#0b0b0f" />
                    </Pressable>
                  );
                })}
              </ScrollView>

              {!main ? (
                <Toggle
                  label={copy.useMain}
                  detail={
                    profile.useMainProviders
                      ? copy.sharedDetail
                      : copy.separateDetail
                  }
                  value={profile.useMainProviders}
                  direction={direction}
                  testID={`profile-share-providers-${profile.id}`}
                  onChange={(value) => {
                    void profiles.setUseMainProviders(profile.id, value);
                  }}
                />
              ) : (
                <Text style={[styles.mainProviderNote, { writingDirection: direction }]}>
                  {copy.mainDetail}
                </Text>
              )}
            </View>
          );
        })}
      </View>

      {profiles.profiles.length < 5 ? (
        <View style={styles.createCard}>
          <Text style={[styles.createTitle, { writingDirection: direction }]}>
            {copy.add}
          </Text>
          <TextInput
            testID="profile-name-input"
            value={name}
            onChangeText={setName}
            placeholder={copy.name}
            placeholderTextColor={theme.colors.muted}
            maxLength={30}
            style={[styles.input, { textAlign: direction === 'rtl' ? 'right' : 'left' }]}
            returnKeyType="done"
            onSubmitEditing={() => { void create(); }}
          />
          <Toggle
            label={copy.useMain}
            detail={copy.createSharedDetail}
            value={newProfileUsesMainProviders}
            direction={direction}
            testID="profile-create-share-providers"
            onChange={setNewProfileUsesMainProviders}
          />
          <Button
            label={copy.create}
            primary
            testID="profile-create"
            disabled={!name.trim()}
            onPress={() => { void create(); }}
          />
        </View>
      ) : (
        <Text style={[styles.limit, { writingDirection: direction }]}>
          {copy.limit}
        </Text>
      )}
    </SettingsPage>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: {
    width: '100%',
    maxWidth: 900,
    alignSelf: 'center',
    padding: 20,
    gap: 18,
  },
  header: { alignItems: 'flex-start', gap: 14 },
  headerCopy: { flex: 1 },
  title: { color: theme.colors.text, fontSize: 30, fontWeight: '900' },
  subtitle: {
    color: theme.colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  list: { gap: 10 },
  profile: {
    gap: 12,
    minHeight: 76,
    padding: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  profileActive: {
    borderColor: '#ffffff',
    backgroundColor: theme.colors.surfaceElevated,
  },
  profileTopRow: {
    alignItems: 'center',
    gap: 12,
  },
  avatarPicker: { gap: 8, paddingVertical: 10 },
  avatarChoice: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  avatarChoiceOn: { borderColor: '#ffffff' },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  avatarActive: {
    backgroundColor: '#ffffff',
    borderColor: '#ffffff',
  },
  avatarText: { color: theme.colors.text, fontSize: 20, fontWeight: '900' },
  avatarTextActive: { color: '#09090b' },
  profileCopy: { flex: 1 },
  profileName: { color: theme.colors.text, fontSize: 17, fontWeight: '900' },
  profileMeta: { color: theme.colors.muted, fontSize: 11, marginTop: 3 },
  mainProviderNote: {
    color: theme.colors.muted,
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 4,
  },
  createCard: {
    gap: 12,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  createTitle: { color: theme.colors.text, fontSize: 17, fontWeight: '900' },
  input: {
    minHeight: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.background,
    color: theme.colors.text,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  toggleRow: {
    minHeight: 66,
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: 'rgba(255,255,255,0.035)',
  },
  toggleCopy: { flex: 1 },
  toggleLabel: { color: theme.colors.text, fontSize: 14, fontWeight: '900' },
  toggleDetail: {
    color: theme.colors.muted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  switchTrack: {
    width: 46,
    height: 28,
    justifyContent: 'center',
    borderRadius: 999,
    paddingHorizontal: 3,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  switchTrackOn: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  switchKnob: {
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: theme.colors.muted,
  },
  switchKnobOn: {
    alignSelf: 'flex-end',
    backgroundColor: '#ffffff',
  },
  button: {
    minHeight: 42,
    justifyContent: 'center',
    borderRadius: 11,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: 14,
  },
  buttonPrimary: { backgroundColor: '#ffffff', borderColor: '#ffffff' },
  buttonText: { color: theme.colors.text, fontSize: 13, fontWeight: '900' },
  buttonTextPrimary: { color: '#09090b' },
  focused: {
    borderColor: theme.colors.focus,
    transform: [{ scale: 1.025 }],
  },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.4 },
  limit: { color: theme.colors.muted, fontSize: 12 },
});

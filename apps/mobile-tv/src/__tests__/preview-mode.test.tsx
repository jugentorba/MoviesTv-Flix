import React from 'react';
import { render, screen } from '@testing-library/react-native';
import AppRoot from '../app/AppRoot';
import { isPreviewMode } from '../services/runtime';

jest.mock('../preferences/PreferencesProvider', () => {
  const ReactModule = require('react');
  return {
    PreferencesProvider: ({ children }: any) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
  };
});

jest.mock('../i18n/I18nProvider', () => {
  const ReactModule = require('react');
  return {
    I18nProvider: ({ children }: any) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
  };
});

jest.mock('../addons/AddonRuntimeProvider', () => {
  const ReactModule = require('react');
  return {
    AddonRuntimeProvider: ({ children }: any) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
  };
});

jest.mock('../catalog/CatalogProvider', () => {
  const ReactModule = require('react');
  return {
    CatalogProvider: ({ children }: any) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
  };
});

jest.mock('../playback/PlaybackProvider', () => {
  const ReactModule = require('react');
  return {
    PlaybackProvider: ({ children }: any) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
  };
});

jest.mock('../playback/PlaybackOverlay', () => ({
  PlaybackOverlay: () => null,
}));

jest.mock('../navigation/AppNavigator', () => {
  const ReactModule = require('react');
  const { Text: MockText } = require('react-native');
  return {
    AppNavigator: () => ReactModule.createElement(MockText, null, 'preview-app-shell'),
  };
});

test('recognizes only explicit preview-mode opt-in values', () => {
  expect(isPreviewMode({ EXPO_PUBLIC_PREVIEW_MODE: '1' })).toBe(true);
  expect(isPreviewMode({ EXPO_PUBLIC_PREVIEW_MODE: 'true' })).toBe(true);
  expect(isPreviewMode({ EXPO_PUBLIC_PREVIEW_MODE: '0' })).toBe(false);
  expect(isPreviewMode({})).toBe(false);
});

test('preview mode opens the local app shell without Supabase configuration', async () => {
  render(
    <AppRoot
      environment={{
        EXPO_PUBLIC_PREVIEW_MODE: '1',
      }}
    />,
  );

  expect(await screen.findByText('preview-app-shell')).toBeTruthy();
});

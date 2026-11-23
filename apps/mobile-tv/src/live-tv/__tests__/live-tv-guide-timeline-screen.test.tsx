import React from 'react';
import { render, screen } from '@testing-library/react-native';
import type { LiveTvChannel } from '@moviestv/live-tv';
import { APP_RESOURCES } from '../../i18n/resources';
import { translateFrom } from '../../i18n/translate';
import { I18nContext } from '../../i18n/useI18n';
import { LiveTvGuideController } from '../LiveTvGuideController';
import { LiveTvGuideTimelineScreen } from '../LiveTvGuideTimelineScreen';

const NOW = Date.UTC(2026, 8, 19, 20, 0, 0);

const channel: LiveTvChannel = {
  id: 'provider-a:channel:fr2',
  providerId: 'provider-a',
  resourceType: 'channel',
  remoteId: 'fr2',
  title: 'France 2',
  countryCode: 'FR',
};

const controller = new LiveTvGuideController(
  {} as never,
  {} as never,
);

function i18n(locale: string) {
  const base = locale.toLowerCase().split('-')[0];
  return {
    locale,
    direction: 'ltr' as const,
    t: (key: string, params?: Record<string, string | number>) => translateFrom(
      APP_RESOURCES[base as keyof typeof APP_RESOURCES] ?? APP_RESOURCES.en,
      APP_RESOURCES.en,
      key,
      params,
    ),
    formatNumber: String,
    formatDate: String,
    languageName: String,
  };
}

function renderTimeline(
  locale: string,
  matched = true,
) {
  return render(
    <I18nContext.Provider value={i18n(locale)}>
      <LiveTvGuideTimelineScreen
        channel={channel}
        guideState={{
          status: 'ready',
          snapshot: {
            sourceRevision: 1,
            fetchedAtMs: NOW,
            channels: [{
              id: 'fr2',
              displayNames: ['France 2'],
              countryCode: 'FR',
            }],
            programmes: matched
              ? [{
                channelId: 'fr2',
                title: 'Journal',
                startAtMs: NOW - 10 * 60 * 1000,
                endAtMs: NOW + 20 * 60 * 1000,
              }]
              : [],
          },
          matches: matched
            ? new Map([[channel.id, 'fr2']])
            : new Map(),
        }}
        controller={controller}
        nowMs={NOW}
        onBack={jest.fn()}
        onPlay={jest.fn()}
      />
    </I18nContext.Provider>,
  );
}

test('renders French programme-guide controls and current badge', () => {
  renderTimeline('fr-FR');

  expect(screen.getByText('‹ Retour')).toBeTruthy();
  expect(screen.getByText('▶ Regarder en direct')).toBeTruthy();
  expect(screen.getByText('GUIDE DES PROGRAMMES')).toBeTruthy();
  expect(screen.getByText('MAINTENANT')).toBeTruthy();
  expect(screen.getByText('Journal')).toBeTruthy();
});

test('renders Albanian empty-guide copy', () => {
  renderTimeline('sq-AL', false);

  expect(screen.getByText('‹ Prapa')).toBeTruthy();
  expect(screen.getByText('▶ Shiko drejtpërdrejt')).toBeTruthy();
  expect(screen.getByText('GUIDA E PROGRAMEVE')).toBeTruthy();
  expect(screen.getByText('Nuk ka program të disponueshëm')).toBeTruthy();
  expect(screen.getByText(
    'Ky kanal nuk përputhet me guidën e konfiguruar, ose nuk ka të dhëna për programin aktual dhe të ardhshëm.',
  )).toBeTruthy();
});

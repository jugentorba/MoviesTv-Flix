import type { LiveTvChannel } from '@moviestv/live-tv';
import { availableLiveTvCountries, buildLiveTvView, liveTvCountryLabel } from '../live-tv-view-model';

const channels: LiveTvChannel[] = [
  { id:'1',providerId:'p',remoteId:'1',resourceType:'channel',title:'RTK 2',countryCode:'XK' },
  { id:'2',providerId:'p',remoteId:'2',resourceType:'channel',title:'RTK 1',countryCode:'AL' },
  { id:'3',providerId:'p',remoteId:'3',resourceType:'channel',title:'France 2',countryCode:'FR' },
  { id:'4',providerId:'p',remoteId:'4',resourceType:'channel',title:'Arte',countryCode:'FR' },
  { id:'5',providerId:'p',remoteId:'5',resourceType:'channel',title:'ZDF',countryCode:'DE' },
];

describe('Live TV view model', () => {
  it('orders preferred countries before alphabetical remainder', () => {
    expect(availableLiveTvCountries(channels)).toEqual(['AL', 'XK', 'FR', 'DE']);
  });

  it('prioritizes Albanian Kosovo and French channels in the all-countries list', () => {
    expect(buildLiveTvView(channels, '', null).map((item) => item.id)).toEqual([
      '2',
      '1',
      '4',
      '3',
      '5',
    ]);
  });

  it('shows localized country names', () => {
    expect(liveTvCountryLabel('AL', 'fr')).toBe('Albanie');
    expect(liveTvCountryLabel('FR', 'fr')).toBe('France');
    expect(liveTvCountryLabel('XK', 'fr')).toBe('Kosovo');
  });

  it('searches locally and sorts titles A-Z', () => {
    expect(buildLiveTvView(channels, '  rtk ', null).map((item) => item.title)).toEqual(['RTK 1', 'RTK 2']);
  });

  it('filters by country and sorts titles A-Z', () => {
    expect(buildLiveTvView(channels, '', 'FR').map((item) => item.title)).toEqual(['Arte', 'France 2']);
  });

  it('maps Kosovo and UK aliases into canonical country filters', () => {
    const aliases: LiveTvChannel[] = [
      {
        id: 'ks',
        providerId: 'p',
        remoteId: 'ks',
        resourceType: 'channel',
        title: 'RTK',
        countryCode: 'KS',
      },
      {
        id: 'xk',
        providerId: 'p',
        remoteId: 'xk',
        resourceType: 'channel',
        title: 'KTV',
        countryCode: 'XK',
      },
      {
        id: 'uk',
        providerId: 'p',
        remoteId: 'uk',
        resourceType: 'channel',
        title: 'BBC',
        countryCode: 'UK',
      },
    ];

    expect(availableLiveTvCountries(aliases)).toEqual(['XK', 'GB']);
    expect(
      buildLiveTvView(aliases, '', 'XK').map((item) => item.id),
    ).toEqual(['xk', 'ks']);
    expect(liveTvCountryLabel('KS', 'fr')).toBe('Kosovo');
  });

  it('normalizes provider country codes for filters without duplicates', () => {
    const mixedCase: LiveTvChannel[] = [
      ...channels,
      {
        id: '6',
        providerId: 'p',
        remoteId: '6',
        resourceType: 'channel',
        title: 'France Info',
        countryCode: 'fr',
      },
    ];

    expect(availableLiveTvCountries(mixedCase)).toEqual([
      'AL',
      'XK',
      'FR',
      'DE',
    ]);
    expect(
      buildLiveTvView(mixedCase, '', 'FR').map((item) => item.title),
    ).toEqual(['Arte', 'France 2', 'France Info']);
  });

});


test('live TV search ignores accents and can match provider or country', () => {
  const channels = [
    { id: '1', providerId: 'france-plus', remoteId: '1', resourceType: 'channel', title: 'Télévision Été', countryCode: 'FR' },
    { id: '2', providerId: 'albania-live', remoteId: '2', resourceType: 'channel', title: 'News', countryCode: 'AL' },
  ] as any[];

  expect(buildLiveTvView(channels, 'television ete', null).map((item) => item.id)).toEqual(['1']);
  expect(buildLiveTvView(channels, 'france-plus', null).map((item) => item.id)).toEqual(['1']);
  expect(buildLiveTvView(channels, 'AL', null).map((item) => item.id)).toEqual(['2']);
});


test('Live TV view hides malformed countries and searches genres', () => {
  const channels = [
    { id: '1', providerId: 'p', remoteId: '1', resourceType: 'tv', title: 'Arena', countryCode: 'FR', genres: ['Sports'] },
    { id: '2', providerId: 'p', remoteId: '2', resourceType: 'tv', title: 'Odd', countryCode: 'FRA' },
  ] as any[];
  expect(availableLiveTvCountries(channels)).toEqual(['FR']);
  expect(buildLiveTvView(channels, 'sports', null).map((item) => item.id)).toEqual(['1']);
});


test('Live TV view search and ordering do not depend on device locale methods', () => {
  const localeLower = jest.spyOn(
    String.prototype,
    'toLocaleLowerCase',
  ).mockImplementation(() => 'locale-dependent');
  const localeCompare = jest.spyOn(
    String.prototype,
    'localeCompare',
  ).mockImplementation(() => 99);

  try {
    const sample = [
      {
        id: '1',
        providerId: 'p',
        remoteId: '1',
        resourceType: 'channel',
        title: 'Éclair TV',
        countryCode: 'FR',
      },
      {
        id: '2',
        providerId: 'p',
        remoteId: '2',
        resourceType: 'channel',
        title: 'Alpha TV',
        countryCode: 'DE',
      },
    ] as LiveTvChannel[];

    expect(
      buildLiveTvView(sample, 'eclair', null).map((item) => item.id),
    ).toEqual(['1']);
    expect(availableLiveTvCountries(sample)).toEqual(['FR', 'DE']);
    expect(localeLower).not.toHaveBeenCalled();
    expect(localeCompare).not.toHaveBeenCalled();
  } finally {
    localeLower.mockRestore();
    localeCompare.mockRestore();
  }
});

import {
  PROVIDER_SETUP_CODE_PREFIX,
  ProviderSetupCodeError,
  decodeProviderSetupCode,
  encodeProviderSetupCode,
  type ProviderSetupEntry,
} from '../setupTransfer';

const example: ProviderSetupEntry[] = [
  {
    addonId: 'stremio.comet.fast',
    manifestUrl: 'https://comet.example/abc123/manifest.json',
    secrets: { debridApiKey: 'KEY-123' },
  },
  {
    addonId: 'org.stremio.torrentio',
    manifestUrl: 'https://torrentio.example/def456/manifest.json',
    secrets: {},
  },
];

test('round-trips provider links and secret fields', () => {
  const code = encodeProviderSetupCode(example);
  expect(code.startsWith(PROVIDER_SETUP_CODE_PREFIX)).toBe(true);
  expect(decodeProviderSetupCode(code)).toEqual(example);
});

test('rejects a code from another app', () => {
  expect(() => decodeProviderSetupCode('hello')).toThrow(ProviderSetupCodeError);
});

test('rejects damaged JSON', () => {
  expect(() => decodeProviderSetupCode(`${PROVIDER_SETUP_CODE_PREFIX}{oops`))
    .toThrow(/damaged/);
});

test('drops entries with a non-https or credentialed URL', () => {
  const code = encodeProviderSetupCode([
    { addonId: 'a.b', manifestUrl: 'http://insecure/manifest.json', secrets: {} },
    { addonId: 'c.d', manifestUrl: 'https://user:pw@host/manifest.json', secrets: {} },
    { addonId: 'e.f', manifestUrl: 'https://ok.example/manifest.json', secrets: {} },
  ]);
  expect(decodeProviderSetupCode(code)).toEqual([
    { addonId: 'e.f', manifestUrl: 'https://ok.example/manifest.json', secrets: {} },
  ]);
});

test('drops control characters in secrets instead of carrying them across', () => {
  const code = encodeProviderSetupCode([
    {
      addonId: 'a.b',
      manifestUrl: 'https://ok.example/manifest.json',
      secrets: { good: 'value', bad: 'line\nbreak' },
    },
  ]);
  expect(decodeProviderSetupCode(code)[0]?.secrets).toEqual({ good: 'value' });
});

test('refuses to encode nothing', () => {
  expect(() => encodeProviderSetupCode([])).toThrow(ProviderSetupCodeError);
});

test('caps the number of providers', () => {
  const many = Array.from({ length: 30 }, (_value, index) => ({
    addonId: `provider.${index}`,
    manifestUrl: `https://host${index}.example/manifest.json`,
    secrets: {},
  }));
  expect(decodeProviderSetupCode(encodeProviderSetupCode(many))).toHaveLength(20);
});

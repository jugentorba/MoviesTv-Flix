import {
  WEB_TV_LAYOUT_STORAGE_KEY,
  formFactorForDimensions,
  isLikelyWebTvUserAgent,
  readWebTvLayoutOverride,
  setWebTvLayoutOverride,
  subscribeWebTvLayoutOverride,
  webTvBootstrapUrlWithoutOverride,
  webTvLayoutRequested,
} from '../platform';

describe('formFactorForDimensions', () => {
  it('keeps large phones in phone mode when rotated', () => {
    expect(formFactorForDimensions(932, 430)).toBe('phone');
    expect(formFactorForDimensions(430, 932)).toBe('phone');
  });

  it('uses the wide layout for tablet and desktop-sized viewports', () => {
    expect(formFactorForDimensions(1024, 768)).toBe('tablet');
    expect(formFactorForDimensions(1440, 900)).toBe('tablet');
    expect(formFactorForDimensions(1280, 540)).toBe('tablet');
  });

  it('always honors TV runtime detection', () => {
    expect(formFactorForDimensions(1280, 720, true)).toBe('tv');
  });
});


test('detects common TV browser user agents without classifying desktop Chrome as TV', () => {
  expect(isLikelyWebTvUserAgent(
    'Mozilla/5.0 (Linux; Android 14; Android TV) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
  )).toBe(true);
  expect(isLikelyWebTvUserAgent(
    'Mozilla/5.0 (Linux; Android 12; AFTMM Build/PS7652) AppleWebKit/537.36 Silk/128 Safari/537.36',
  )).toBe(true);
  expect(isLikelyWebTvUserAgent(
    'Mozilla/5.0 (SMART-TV; Linux; Tizen 8.0) AppleWebKit/537.36',
  )).toBe(true);
  expect(isLikelyWebTvUserAgent(
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
  )).toBe(false);
  expect(isLikelyWebTvUserAgent(
    'Mozilla/5.0 (Linux; Android 16; Pixel 10 Pro) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36',
  )).toBe(false);
});

test('persists and clears the device-local web TV layout override', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };

  expect(readWebTvLayoutOverride(storage)).toBe(false);

  setWebTvLayoutOverride(true, storage);
  expect(values.get(WEB_TV_LAYOUT_STORAGE_KEY)).toBe('tv');
  expect(readWebTvLayoutOverride(storage)).toBe(true);

  setWebTvLayoutOverride(false, storage);
  expect(values.has(WEB_TV_LAYOUT_STORAGE_KEY)).toBe(false);
  expect(readWebTvLayoutOverride(storage)).toBe(false);
});

test('notifies mounted layout consumers when the web TV override changes', () => {
  const seen: boolean[] = [];
  const storage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  const unsubscribe = subscribeWebTvLayoutOverride((forced) => {
    seen.push(forced);
  });

  setWebTvLayoutOverride(true, storage);
  setWebTvLayoutOverride(false, storage);
  unsubscribe();
  setWebTvLayoutOverride(true, storage);

  expect(seen).toEqual([true, false]);
});

test('fails safely when browser storage is unavailable', () => {
  const broken = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };

  expect(readWebTvLayoutOverride(broken)).toBe(false);
  expect(() => setWebTvLayoutOverride(true, broken)).not.toThrow();
});

test('accepts only explicit TV layout bootstrap query values', () => {
  expect(webTvLayoutRequested('?tv=1')).toBe(true);
  expect(webTvLayoutRequested('?layout=tv')).toBe(true);
  expect(webTvLayoutRequested('?layout=TV&source=homescreen')).toBe(true);
  expect(webTvLayoutRequested('?tv=0')).toBe(false);
  expect(webTvLayoutRequested('?layout=tablet')).toBe(false);
  expect(webTvLayoutRequested('?next=https%3A%2F%2Fevil.example')).toBe(false);
  expect(webTvLayoutRequested(undefined)).toBe(false);
});

test('removes only the one-shot TV bootstrap parameter from the URL', () => {
  expect(webTvBootstrapUrlWithoutOverride(
    'https://app.example/?tv=1&source=homescreen#live',
  )).toBe('/?source=homescreen#live');
  expect(webTvBootstrapUrlWithoutOverride(
    'https://app.example/watch?layout=TV&id=42',
  )).toBe('/watch?id=42');
  expect(webTvBootstrapUrlWithoutOverride(
    'https://app.example/?tv=0&layout=tablet',
  )).toBeNull();
  expect(webTvBootstrapUrlWithoutOverride('not a url')).toBeNull();
});


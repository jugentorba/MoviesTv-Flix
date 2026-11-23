import {
  compareVersions,
  installDesktopUpdate,
  isTrustedDesktopDownload,
  latestDesktopRelease,
  parseVersion,
} from '../desktopUpdate';

describe('desktop update discovery', () => {
  it('orders versions numerically, not as text', () => {
    expect(compareVersions('0.7.10', '0.7.9')).toBeGreaterThan(0);
    expect(compareVersions('0.7.2', '0.7.2')).toBe(0);
    expect(compareVersions('0.6.9', '0.7.0')).toBeLessThan(0);
    expect(compareVersions('v1.0', '1.0.0')).toBe(0);
    expect(compareVersions('nightly', '1.0')).toBeNull();
  });

  it('parses tags with and without a prefix', () => {
    expect(parseVersion('v0.7.2')).toEqual([0, 7, 2]);
    expect(parseVersion('0.7')).toEqual([0, 7]);
    expect(parseVersion('0.7.2-beta')).toBeNull();
  });

  it('picks the macOS disk image and ignores other assets', () => {
    const release = latestDesktopRelease({
      tag_name: 'v0.7.3',
      html_url: 'https://github.com/jugentorba/MoviesTv-Flix/releases/tag/v0.7.3',
      body: 'notes',
      assets: [
        { name: 'MoviesTv-Flix-0.7.3-ios.ipa', browser_download_url: 'https://github.com/a.ipa' },
        {
          name: 'MoviesTv-Flix-0.7.3-macos.dmg',
          browser_download_url: 'https://github.com/jugentorba/MoviesTv-Flix/releases/download/v0.7.3/x.dmg',
        },
      ],
    });
    expect(release?.version).toBe('0.7.3');
    expect(release?.downloadUrl).toContain('/x.dmg');
    expect(release?.releaseNotes).toBe('notes');
  });

  it('rejects releases without a usable version', () => {
    expect(latestDesktopRelease({ tag_name: 'latest' })).toBeNull();
    expect(latestDesktopRelease(null)).toBeNull();
  });

  it('only trusts GitHub over https', () => {
    expect(isTrustedDesktopDownload('https://github.com/a/b.dmg')).toBe(true);
    expect(isTrustedDesktopDownload('https://objects.githubusercontent.com/a.dmg')).toBe(true);
    expect(isTrustedDesktopDownload('http://github.com/a.dmg')).toBe(false);
    expect(isTrustedDesktopDownload('https://evil.example/a.dmg')).toBe(false);
  });

  it('calls the native installer only through the bridge', () => {
    const installUpdate = jest.fn();
    (globalThis as { window?: unknown }).window = {
      __MOVIESTV_NATIVE__: { installUpdate },
    };
    expect(installDesktopUpdate('https://evil.example/a.dmg')).toBe(false);
    expect(installUpdate).not.toHaveBeenCalled();

    expect(installDesktopUpdate('https://github.com/a.dmg')).toBe(true);
    expect(installUpdate).toHaveBeenCalledWith('https://github.com/a.dmg');
    delete (globalThis as { window?: unknown }).window;
  });
});

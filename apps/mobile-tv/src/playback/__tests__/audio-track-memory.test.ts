import AsyncStorage from '@react-native-async-storage/async-storage';
import { readRememberedAudioTrack, rememberAudioTrack } from '../audioTrackMemory';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('audio track memory', () => {
  it('remembers a choice per source fingerprint', async () => {
    await rememberAudioTrack('source-a', 'audio:2');
    expect(await readRememberedAudioTrack('source-a')).toBe('audio:2');
    // A different source is unaffected.
    expect(await readRememberedAudioTrack('source-b')).toBeNull();
  });

  it('clears the memory when the choice is reset', async () => {
    await rememberAudioTrack('source-a', 'audio:2');
    await rememberAudioTrack('source-a', null);
    expect(await readRememberedAudioTrack('source-a')).toBeNull();
  });

  it('ignores an empty fingerprint instead of writing a bad key', async () => {
    await rememberAudioTrack('', 'audio:1');
    expect(await readRememberedAudioTrack('')).toBeNull();
  });

  it('never throws when storage fails', async () => {
    const spy = jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
    await expect(readRememberedAudioTrack('source-a')).resolves.toBeNull();
    spy.mockRestore();
  });
});

import { formatByteSize, formatTransferSummary } from '../downloadTransfer';

test('a large film reports its remaining size in GB, not thousands of MB', () => {
  const sixGb = 6 * 1024 * 1024 * 1024;
  const summary = formatTransferSummary({
    bytesWritten: 512 * 1024 * 1024,
    bytesTotal: sixGb,
    bytesPerSecond: 2.4 * 1024 * 1024,
  });

  expect(summary).toBe('512 MB of 6.0 GB · 2.4 MB/s · 5.5 GB left');
});

test('no rate still gives written and remaining', () => {
  expect(formatTransferSummary({
    bytesWritten: 100 * 1024 * 1024,
    bytesTotal: 400 * 1024 * 1024,
  })).toBe('100 MB of 400 MB · 300 MB left');
});

test('an unknown total does not invent one', () => {
  expect(formatTransferSummary({
    bytesWritten: 50 * 1024 * 1024,
    bytesPerSecond: 1024 * 1024,
  })).toBe('50 MB downloaded · 1.0 MB/s');
});

test('nothing reported means no line at all', () => {
  expect(formatTransferSummary({})).toBeNull();
  expect(formatTransferSummary({ bytesTotal: 0, bytesWritten: 0 })).toBeNull();
});

test('a finished transfer drops the remaining part', () => {
  expect(formatTransferSummary({
    bytesWritten: 400 * 1024 * 1024,
    bytesTotal: 400 * 1024 * 1024,
  })).toBe('400 MB of 400 MB');
});

test('sizes below a megabyte stay readable', () => {
  expect(formatByteSize(900)).toBe('900 B');
  expect(formatByteSize(15 * 1024)).toBe('15 KB');
});

export interface DownloadTransferSample {
  bytesWritten?: number;
  bytesTotal?: number;
  bytesPerSecond?: number;
}

/**
 * Sizes are read in the unit the number deserves: a 6 GB film should say
 * `5.5 GB left`, not `5632 MB left`.
 */
export function formatByteSize(value?: number): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

/**
 * The transfer line under a running download.
 *
 * Written of total, the current rate, and how much is left — the two numbers a
 * person actually watches. Platforms report these separately and sometimes not
 * at all, so every part is optional and the line degrades instead of lying.
 */
export function formatTransferSummary(job: DownloadTransferSample): string | null {
  const written = formatByteSize(job.bytesWritten);
  const total = formatByteSize(job.bytesTotal);
  const rate = formatByteSize(job.bytesPerSecond);
  const parts: string[] = [];

  if (written && total) parts.push(`${written} of ${total}`);
  else if (written) parts.push(`${written} downloaded`);

  if (rate) parts.push(`${rate}/s`);

  if (
    typeof job.bytesWritten === 'number'
    && typeof job.bytesTotal === 'number'
    && job.bytesTotal > job.bytesWritten
  ) {
    const left = formatByteSize(job.bytesTotal - job.bytesWritten);
    if (left) parts.push(`${left} left`);
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}

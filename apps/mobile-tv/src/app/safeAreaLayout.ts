export function safeInsetEdge(
  base: number,
  inset: number,
  gap = 0,
): number {
  const safeBase = Number.isFinite(base) ? Math.max(0, base) : 0;
  const safeInset = Number.isFinite(inset) ? Math.max(0, inset) : 0;
  const safeGap = Number.isFinite(gap) ? Math.max(0, gap) : 0;
  return Math.max(safeBase, safeInset + safeGap);
}

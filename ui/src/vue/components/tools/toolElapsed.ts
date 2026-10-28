/** Wall-clock duration of a running tool, rounded down to whole seconds. */
export function elapsedSince(startTime: string | null | undefined, now: number): string {
  if (!startTime) return "";
  const start = Date.parse(startTime);
  if (!Number.isFinite(start) || !Number.isFinite(now)) return "";

  const totalSeconds = Math.floor(Math.max(0, now - start) / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }
  if (totalSeconds >= 60) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}

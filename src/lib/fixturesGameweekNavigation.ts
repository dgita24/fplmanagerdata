export function getAvailableGameweeks(values: string[]): number[] {
  const unique = new Set<number>();
  for (const value of values) {
    const gw = Number.parseInt(value, 10);
    if (Number.isInteger(gw) && gw > 0) unique.add(gw);
  }
  return Array.from(unique).sort((a, b) => a - b);
}

export function resolveGameweekSelection(
  availableGameweeks: number[],
  selectedGw?: number | null
): number | null {
  if (availableGameweeks.length === 0) return null;
  if (selectedGw == null || !Number.isInteger(selectedGw)) return null;
  if (availableGameweeks.includes(selectedGw)) return selectedGw;

  const firstGw = availableGameweeks[0];
  const lastGw = availableGameweeks[availableGameweeks.length - 1];
  if (selectedGw < firstGw) return firstGw;
  if (selectedGw > lastGw) return lastGw;
  return null;
}

export function getGameweekNeighbors(availableGameweeks: number[], gw: number): {
  previous: number | null;
  next: number | null;
} {
  const index = availableGameweeks.indexOf(gw);
  if (index < 0) return { previous: null, next: null };
  return {
    previous: index > 0 ? availableGameweeks[index - 1] : null,
    next: index < availableGameweeks.length - 1 ? availableGameweeks[index + 1] : null,
  };
}

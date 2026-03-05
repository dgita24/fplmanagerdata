/**
 * Transfer Summary helper.
 *
 * Aggregates how many times each player was transferred in/out across a set of
 * raw FPL transfer records (from /api/fpl/entry/{id}/transfers) for a given GW.
 */

export interface FplTransfer {
  /** Gameweek the transfer occurred in */
  event: number;
  /** Player ID transferred in */
  element_in: number;
  /** Player ID transferred out */
  element_out: number;
}

export interface TransferCount {
  playerId: number;
  count: number;
}

export interface TransferSummary {
  /** Players transferred in, sorted by count descending */
  transferredIn: TransferCount[];
  /** Players transferred out, sorted by count descending */
  transferredOut: TransferCount[];
}

/**
 * Given an array of FPL transfer records (possibly from multiple managers),
 * filter by `gw` and return aggregated IN/OUT counts per player.
 *
 * @param transfers - Flat array of all transfers across all managers.
 * @param gw - Gameweek number to filter by.
 * @returns Aggregated counts sorted by count descending.
 */
export function aggregateTransferSummary(
  transfers: FplTransfer[],
  gw: number
): TransferSummary {
  const inCounts = new Map<number, number>();
  const outCounts = new Map<number, number>();

  for (const t of transfers) {
    if (t.event !== gw) continue;
    inCounts.set(t.element_in, (inCounts.get(t.element_in) ?? 0) + 1);
    outCounts.set(t.element_out, (outCounts.get(t.element_out) ?? 0) + 1);
  }

  const toSorted = (map: Map<number, number>): TransferCount[] =>
    [...map.entries()]
      .map(([playerId, count]) => ({ playerId, count }))
      .sort((a, b) => b.count - a.count || a.playerId - b.playerId);

  return {
    transferredIn: toSorted(inCounts),
    transferredOut: toSorted(outCounts),
  };
}

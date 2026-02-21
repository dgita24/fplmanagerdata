export const SQUADS_SNAPSHOT_KEY = "fpl_squads_snapshot_v1";

export type SquadsSnapshot = {
  savedAt: number;
  managerIds: number[];
  gw: number;
  latestGW: number;
  allSquadsData: any[];
  ui: {
    gwFilter: string;
    managerFilter: string;
    viewFilter: string;
  };
};

export function safeJsonParse(value: string | null) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

export function normalizeIds(ids: any): number[] {
  return (Array.isArray(ids) ? ids : []).map((x) => Number(x)).filter((n) => Number.isFinite(n));
}

export function sameManagerIds(a: any, b: any) {
  const aa = normalizeIds(a).sort((x, y) => x - y);
  const bb = normalizeIds(b).sort((x, y) => x - y);
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) return false;
  return true;
}

export function loadSquadsSnapshot(): SquadsSnapshot | null {
  return safeJsonParse(localStorage.getItem(SQUADS_SNAPSHOT_KEY));
}

export function saveSquadsSnapshot(
  key: string,
  managerIds: number[],
  latestGW: number,
  allSquadsData: any[],
  gwFilter: string,
  managerFilter: string,
  viewFilter: string,
  gw: number
): void {
  const snap: SquadsSnapshot = {
    savedAt: Date.now(),
    managerIds: [...managerIds],
    gw,
    latestGW,
    allSquadsData,
    ui: {
      gwFilter,
      managerFilter,
      viewFilter,
    },
  };

  try {
    localStorage.setItem(key, JSON.stringify(snap));
  } catch (e) {
    console.warn("Could not save squads snapshot", e);
  }
}

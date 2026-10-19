export type ManagerSquad = {
  entryId: number
  managerName: string
  teamName: string
  playerIds: number[]
}

export type LoadResult = {
  gw: number
  squads: ManagerSquad[]
  failed: number[]
  loadedAt: number
}

export type TableRow = Record<string, string | number>

const NAMES_KEY = 'fpl-manager-names-v1'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function getJson(url: string, retries = 3): Promise<any | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (res.ok) return await res.json()
      // permanent client error (not rate limit): don't retry
      if (res.status !== 429 && res.status < 500) return null
    } catch {
      // network error: retry
    }
    if (attempt < retries) await sleep(400 * 2 ** attempt + Math.random() * 250)
  }
  return null
}

function loadNames(): Record<string, { m: string; t: string }> {
  try {
    return JSON.parse(localStorage.getItem(NAMES_KEY) || '{}')
  } catch {
    return {}
  }
}

/**
 * Fetch current-GW picks for every manager from the browser (no Cloudflare
 * Worker subrequest cap). Failures are reported, never silently dropped.
 */
export async function loadSquads(
  managerIds: number[],
  gw: number,
  opts: { concurrency?: number; onProgress?: (done: number, total: number) => void } = {}
): Promise<LoadResult> {
  const concurrency = opts.concurrency ?? 4
  const names = loadNames()
  const squads: ManagerSquad[] = []
  const failed: number[] = []
  let next = 0
  let done = 0

  async function worker() {
    while (true) {
      const i = next++
      if (i >= managerIds.length) return
      const id = managerIds[i]

      const picks = await getJson(`/api/fpl/entry/${id}/event/${gw}/picks/`)
      if (!picks || !Array.isArray(picks.picks)) {
        failed.push(id)
      } else {
        // Names are cached in localStorage; a failed name lookup is non-fatal.
        if (!names[id]) {
          const s = await getJson(`/api/fpl/entry/${id}/`, 1)
          if (s) {
            names[id] = {
              m: `${s.player_first_name || ''} ${s.player_last_name || ''}`.trim() || `Entry ${id}`,
              t: String(s.name || '-'),
            }
          }
        }
        squads.push({
          entryId: id,
          managerName: names[id]?.m || `Entry ${id}`,
          teamName: names[id]?.t || '-',
          playerIds: [
            ...new Set<number>(
              picks.picks.map((p: any) => Number(p?.element)).filter((n: number) => Number.isFinite(n) && n > 0)
            ),
          ],
        })
      }
      opts.onProgress?.(++done, managerIds.length)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, managerIds.length) }, worker))

  try {
    localStorage.setItem(NAMES_KEY, JSON.stringify(names))
  } catch {
    // storage full / unavailable: ignore
  }

  squads.sort((a, b) => a.managerName.localeCompare(b.managerName))
  failed.sort((a, b) => a - b)
  return { gw, squads, failed, loadedAt: Date.now() }
}

export function matchOwners(squads: ManagerSquad[], selectedIds: number[], mode: 'all' | 'any') {
  const sel = new Set(selectedIds)
  return squads
    .map((s) => ({ ...s, matched: s.playerIds.filter((id) => sel.has(id)) }))
    .filter((s) => (mode === 'any' ? s.matched.length > 0 : s.matched.length === sel.size))
}

export function matchClub(
  squads: ManagerSquad[],
  clubPlayerIds: Set<number>,
  count: number,
  mode: 'exact' | 'atleast'
) {
  return squads
    .map((s) => ({ ...s, matched: s.playerIds.filter((id) => clubPlayerIds.has(id)) }))
    .filter((s) => (mode === 'atleast' ? s.matched.length >= count : s.matched.length === count))
}

export function toCsv(rows: TableRow[]): string {
  if (rows.length === 0) return ''
  const cell = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const cols = Object.keys(rows[0])
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n')
}

export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
  )
}

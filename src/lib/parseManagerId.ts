export function parseManagerIdFromInput(raw: string): number | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  if (/^\d+$/.test(s)) return Number(s)
  const m = s.match(/\/entry\/(\d+)(?:\/|$)/i)
  if (m?.[1]) return Number(m[1])
  const n = s.match(/\b(\d{3,})\b/)
  if (n?.[1]) return Number(n[1])
  return null
}

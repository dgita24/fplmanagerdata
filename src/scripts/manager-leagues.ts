type ManagerLeague = {
  id: number
  name: string | null
  type: 'classic' | 'h2h'
  alreadySaved: boolean
}

type SetupOptions = {
  supabase: any
  currentUser: { id: string }
  loadSavedLeagues: () => Promise<void>
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      case "'": return '&#39;'
      default: return ch
    }
  })
}

function parseManagerIdFromInput(raw: string): number | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  if (/^\d+$/.test(s)) return Number(s)
  const m = s.match(/\/entry\/(\d+)(?:\/|$)/i)
  if (m?.[1]) return Number(m[1])
  const n = s.match(/\b(\d{3,})\b/)
  if (n?.[1]) return Number(n[1])
  return null
}

export function setupManagerLeagueImport({ supabase, currentUser, loadSavedLeagues }: SetupOptions) {
  const managerLeaguesOpenBtn = document.getElementById('manager-leagues-open') as HTMLButtonElement
  const managerLeaguesSheet = document.getElementById('manager-leagues-sheet') as HTMLElement
  const managerLeaguesCloseBtn = document.getElementById('manager-leagues-close') as HTMLButtonElement
  const managerLeaguesEntryInput = document.getElementById('manager-leagues-entry') as HTMLInputElement
  const managerLeaguesFetchBtn = document.getElementById('manager-leagues-fetch') as HTMLButtonElement
  const managerLeaguesApplyBtn = document.getElementById('manager-leagues-apply') as HTMLButtonElement
  const managerLeaguesStatusEl = document.getElementById('manager-leagues-status') as HTMLElement
  const managerLeaguesListEl = document.getElementById('manager-leagues-list') as HTMLElement

  if (!managerLeaguesOpenBtn || !managerLeaguesSheet) return

  let managerLeagues: ManagerLeague[] = []
  const selectedManagerLeagueIds = new Set<number>()
  let savedLeagueIds = new Set<number>()

  function openManagerLeaguesSheet() {
    managerLeaguesSheet.classList.add('is-open')
    managerLeaguesSheet.setAttribute('aria-hidden', 'false')
  }

  function closeManagerLeaguesSheet() {
    managerLeaguesSheet.classList.remove('is-open')
    managerLeaguesSheet.setAttribute('aria-hidden', 'true')
  }

  async function fetchSavedLeagueIds(): Promise<Set<number>> {
    const { data, error } = await supabase
      .from('user_saved_leagues')
      .select('league_id')
      .eq('user_id', currentUser.id)

    if (error) {
      console.error(error)
      return new Set<number>()
    }
    return new Set<number>((data || []).map((r: any) => Number(r.league_id)))
  }

  function syncSelectedManagerLeaguesFromDom() {
    selectedManagerLeagueIds.clear()
    managerLeaguesListEl
      .querySelectorAll<HTMLInputElement>('input.manager-leagues-check')
      .forEach((cb) => {
        const id = Number(cb.dataset.leagueId)
        if (!Number.isFinite(id)) return
        if (cb.checked && !cb.disabled) selectedManagerLeagueIds.add(id)
      })
  }

  function renderManagerLeaguesList() {
    if (managerLeagues.length === 0) {
      managerLeaguesListEl.innerHTML = `<div class="text-muted">No leagues found for this manager.</div>`
      return
    }

    const sections: Array<{ label: string; type: 'classic' | 'h2h' }> = [
      { label: 'Classic leagues', type: 'classic' },
      { label: 'Head-to-head leagues', type: 'h2h' },
    ]

    const html: string[] = []
    sections.forEach((section) => {
      const items = managerLeagues.filter((l) => l.type === section.type)
      if (items.length === 0) return

      html.push(`<div class="featured-category">${section.label}</div>`)

      items.forEach((l) => {
        const name = escapeHtml(l.name ?? `League ${l.id}`)
        const checked = l.alreadySaved ? 'checked' : ''
        const disabled = l.alreadySaved ? 'disabled' : ''
        const note = l.alreadySaved ? 'Saved' : 'Not saved'

        html.push(`
          <label class="featured-item">
            <input type="checkbox" class="manager-leagues-check" data-league-id="${l.id}" ${checked} ${disabled} />
            <div class="featured-item__content">
              <div class="featured-item__name">${name}</div>
              <div class="featured-item__note">${note}</div>
            </div>
          </label>
        `)
      })
    })

    managerLeaguesListEl.innerHTML = html.join('')

    managerLeaguesListEl
      .querySelectorAll<HTMLInputElement>('input.manager-leagues-check')
      .forEach((cb) => {
        cb.addEventListener('change', () => {
          syncSelectedManagerLeaguesFromDom()
          updateManagerLeaguesActions()
        })
      })
  }

  function updateManagerLeaguesActions() {
    const toSave = managerLeagues.filter((l) => !l.alreadySaved && selectedManagerLeagueIds.has(l.id))
    managerLeaguesApplyBtn.disabled = toSave.length === 0
    managerLeaguesApplyBtn.textContent = 'Save selected leagues'
  }

  async function fetchManagerLeagues() {
    managerLeaguesStatusEl.textContent = ''
    managerLeaguesListEl.innerHTML = ''
    managerLeaguesApplyBtn.disabled = true
    managerLeagues = []
    selectedManagerLeagueIds.clear()

    const entryId = parseManagerIdFromInput(managerLeaguesEntryInput.value)
    if (!entryId || !Number.isFinite(entryId)) {
      managerLeaguesStatusEl.textContent = 'Enter a valid Manager ID or URL.'
      return
    }

    managerLeaguesFetchBtn.disabled = true
    managerLeaguesStatusEl.textContent = 'Loading leagues...'

    try {
      savedLeagueIds = await fetchSavedLeagueIds()

      const res = await fetch(`/api/fpl/entry/${entryId}/`)
      if (!res.ok) throw new Error('Entry lookup failed')
      const data = await res.json()

      const classic = Array.isArray(data?.leagues?.classic) ? data.leagues.classic : []
      const h2h = Array.isArray(data?.leagues?.h2h) ? data.leagues.h2h : []

      const classicLeagues: ManagerLeague[] = classic.map((l: any) => ({
        id: Number(l.id),
        name: l.name ? String(l.name) : null,
        type: 'classic',
        alreadySaved: savedLeagueIds.has(Number(l.id)),
      }))

      const h2hLeagues: ManagerLeague[] = h2h.map((l: any) => ({
        id: Number(l.id),
        name: l.name ? String(l.name) : null,
        type: 'h2h',
        alreadySaved: savedLeagueIds.has(Number(l.id)),
      }))

      managerLeagues = [...classicLeagues, ...h2hLeagues].filter((l) => Number.isFinite(l.id))

      managerLeaguesStatusEl.textContent = managerLeagues.length
        ? `Found ${managerLeagues.length} leagues.`
        : 'No leagues found for this manager.'

      renderManagerLeaguesList()
      updateManagerLeaguesActions()
    } catch (e) {
      console.error(e)
      managerLeaguesStatusEl.textContent = 'Could not load leagues. Try again.'
    } finally {
      managerLeaguesFetchBtn.disabled = false
    }
  }

  async function saveSelectedManagerLeagues() {
    managerLeaguesStatusEl.textContent = ''

    const toSave = managerLeagues.filter((l) => !l.alreadySaved && selectedManagerLeagueIds.has(l.id))
    if (toSave.length === 0) {
      managerLeaguesStatusEl.textContent = 'No new leagues selected.'
      return
    }

    const cap = 15
    savedLeagueIds = await fetchSavedLeagueIds()
    const totalAfter = savedLeagueIds.size + toSave.length
    if (totalAfter > cap) {
      managerLeaguesStatusEl.textContent = `Too many leagues. Limit is ${cap}.`
      return
    }

    const payload = toSave.map((l) => ({
      user_id: currentUser.id,
      league_id: l.id,
      league_name: l.name,
      updated_at: new Date().toISOString(),
    }))

    managerLeaguesApplyBtn.disabled = true

    const { error } = await supabase
      .from('user_saved_leagues')
      .upsert(payload, { onConflict: 'user_id,league_id' })

    if (error) {
      console.error(error)
      managerLeaguesStatusEl.textContent = 'Failed to save leagues.'
      managerLeaguesApplyBtn.disabled = false
      return
    }

    managerLeaguesStatusEl.textContent = `Saved ${toSave.length} league(s).`
    await loadSavedLeagues()

    savedLeagueIds = await fetchSavedLeagueIds()
    managerLeagues = managerLeagues.map((l) => ({
      ...l,
      alreadySaved: savedLeagueIds.has(l.id),
    }))
    selectedManagerLeagueIds.clear()
    renderManagerLeaguesList()
    updateManagerLeaguesActions()
    managerLeaguesApplyBtn.disabled = false
  }

  managerLeaguesOpenBtn.addEventListener('click', () => {
    managerLeaguesEntryInput.value = ''
    managerLeaguesStatusEl.textContent = ''
    managerLeaguesListEl.innerHTML = ''
    managerLeaguesApplyBtn.disabled = true
    managerLeagues = []
    selectedManagerLeagueIds.clear()
    openManagerLeaguesSheet()
  })

  managerLeaguesCloseBtn?.addEventListener('click', () => closeManagerLeaguesSheet())
  managerLeaguesFetchBtn?.addEventListener('click', () => fetchManagerLeagues())
  managerLeaguesApplyBtn?.addEventListener('click', () => saveSelectedManagerLeagues())
}

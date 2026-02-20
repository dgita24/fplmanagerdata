  import { supabase } from '../lib/supabase.ts'
  import { featuredManagers } from '../data/featuredManagers'
  import { setupManagerLeagueImport } from '../scripts/manager-leagues'

  // =========================
  // Single source of truth
  // =========================
  const MAX_MANAGERS = 50

  const authCheckDiv = document.getElementById('auth-check') as HTMLElement
  const loadingDiv = document.getElementById('loading') as HTMLElement
  const requireLoginDiv = document.getElementById('require-login') as HTMLElement
  const form = document.getElementById('manager-form') as HTMLFormElement
  const textarea = document.getElementById('ids') as HTMLTextAreaElement
  const status = document.getElementById('status') as HTMLElement
  const countEl = document.getElementById('count') as HTMLElement
  const editBtn = document.getElementById('edit-btn') as HTMLButtonElement
  const saveBtn = document.getElementById('save-btn') as HTMLButtonElement

  let currentUser: any = null
  let isEditing = false

  async function checkAuth() {
    const { data: { user } } = await supabase.auth.getUser()

    if (user) {
      currentUser = user
      loadingDiv.style.display = 'none'
      authCheckDiv.style.display = 'block'
      loadManagerIds()
      setupManagerLeagueImport({ supabase, currentUser, loadSavedLeagues })
    } else {
      loadingDiv.style.display = 'none'
      requireLoginDiv.style.display = 'block'
    }
  }

  async function loadManagerIds() {
    try {
      const { data, error } = await supabase
        .from('user_manager_lists')
        .select('manager_ids')
        .eq('user_id', currentUser.id)
        .single()

      if (error && error.code !== 'PGRST116') {
        console.error('Error loading manager IDs:', error)
        return
      }

      if (data && data.manager_ids) {
        textarea.value = data.manager_ids.join('\n')
        updateCount()
      } else {
        textarea.value = ''
        updateCount()
      }
    } catch (e) {
      console.error('Error:', e)
    }
  }

  async function saveManagerIds(ids: number[]) {
    try {
      const { data: existing } = await supabase
        .from('user_manager_lists')
        .select('id')
        .eq('user_id', currentUser.id)
        .single()

      if (existing) {
        const { error } = await supabase
          .from('user_manager_lists')
          .update({
            manager_ids: ids,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', currentUser.id)

        if (error) throw error
      } else {
        const { error } = await supabase
          .from('user_manager_lists')
          .insert({
            user_id: currentUser.id,
            manager_ids: ids
          })

        if (error) throw error
      }

      if (ids.length === 0) {
        const { error: cleanupError } = await supabase
          .from('user_league_imports')
          .delete()
          .eq('user_id', currentUser.id)

        if (cleanupError) throw cleanupError
      } else {
        const idsCsv = `(${ids.join(',')})`
        const { error: cleanupError } = await supabase
          .from('user_league_imports')
          .delete()
          .eq('user_id', currentUser.id)
          .not('entry_id', 'in', idsCsv)

        if (cleanupError) throw cleanupError
      }

      return true
    } catch (e) {
      console.error('Error saving manager IDs:', e)
      return false
    }
  }

  function updateCount() {
    const ids = textarea.value.trim().split(/[\s,]+/).filter(x => x.match(/^\d+$/))
    countEl.textContent = String(ids.length)
    if (ids.length > MAX_MANAGERS) {
      countEl.style.color = "var(--color-danger)"
      countEl.textContent = `${ids.length} (max ${MAX_MANAGERS}!)`
    } else {
      countEl.style.color = ids.length > 0 ? "var(--color-success)" : "var(--color-text-muted)"
    }
  }

  function setEditMode(editing: boolean, options: { preserveStatus?: boolean } = {}) {
    isEditing = editing
    textarea.disabled = !editing
    saveBtn.disabled = !editing
    editBtn.textContent = editing ? '❌ Cancel' : '✏️ Edit'

    if (!editing) {
      loadManagerIds()
      if (!options.preserveStatus) {
        status.innerHTML = ''
      }
    }
  }
  editBtn.addEventListener('click', () => {
    setEditMode(!isEditing)
  })

  textarea.addEventListener('input', updateCount)

  form.onsubmit = async (e) => {
    e.preventDefault()

    if (!isEditing) return

    const ids = textarea.value.trim().split(/[\s,]+/).filter(x => x.match(/^\d+$/))

    if (ids.length === 0) {
      status.innerHTML = "<p class='status status--error'>⚠️ Enter at least one valid EntryID.</p>"
      return
    }

    if (ids.length > MAX_MANAGERS) {
      status.innerHTML = `<p class='status status--error'>⚠️ Maximum ${MAX_MANAGERS} managers allowed.</p>`
      return
    }

    const uniqueIds = [...new Set(ids)].map(id => parseInt(id))

    const success = await saveManagerIds(uniqueIds)

    if (success) {
      let msg = `<p class='status status--success'>✅ Saved ${uniqueIds.length} manager IDs!</p>`

      if (uniqueIds.length !== ids.length) {
        textarea.value = uniqueIds.join('\n')
        updateCount()
        msg += `<p class='status status--warning' style='margin-top: var(--space-2);'>Removed ${ids.length - uniqueIds.length} duplicate(s).</p>`
      }
      status.innerHTML = msg
      setEditMode(false)
    } else {
      status.innerHTML = "<p class='status status--error'>❌ Error saving. Please try again.</p>"
    }
  }

  // =========================
  // Featured managers top sheet
  // =========================
  const featuredOpenBtn = document.getElementById('featured-open') as HTMLButtonElement
  const featuredSheet = document.getElementById('featured-sheet') as HTMLElement
  const featuredCloseBtn = document.getElementById('featured-close') as HTMLButtonElement
  const featuredListEl = document.getElementById('featured-list') as HTMLElement
  const featuredSearchInput = document.getElementById('featured-search') as HTMLInputElement
  const featuredApplyBtn = document.getElementById('featured-apply') as HTMLButtonElement
  const featuredClearBtn = document.getElementById('featured-clear') as HTMLButtonElement
  const featuredStatusEl = document.getElementById('featured-status') as HTMLElement
  const featuredDeltaEl = document.getElementById('featured-delta') as HTMLElement
  const managerHistorySheet = document.getElementById('manager-history-sheet') as HTMLElement
  const managerHistoryCloseBtn = document.getElementById('manager-history-close') as HTMLButtonElement
  const managerHistoryTitleEl = document.getElementById('manager-history-title') as HTMLElement
  const managerHistoryStatusEl = document.getElementById('manager-history-status') as HTMLElement
  const managerHistoryListEl = document.getElementById('manager-history-list') as HTMLElement
  const managerHistorySummaryEl = document.getElementById('manager-history-summary') as HTMLElement

  const selectedFeaturedIds = new Set<number>()
  
  const featuredEntryIds = new Set<number>(featuredManagers.map((m) => Number(m.entryId)))

  function syncSelectedFeaturedIdsFromDom() {
    const next = new Set<number>()
    featuredListEl
      .querySelectorAll<HTMLInputElement>('input.featured-check')
      .forEach((cb) => {
        const entryId = Number(cb.dataset.id)
        if (!Number.isFinite(entryId)) return
        if (cb.checked) next.add(entryId)
      })
    selectedFeaturedIds.clear()
    next.forEach((id) => selectedFeaturedIds.add(id))
  }

  function openFeaturedSheet() {
    featuredSheet.classList.add('is-open')
    featuredSheet.setAttribute('aria-hidden', 'false')
  }

  function closeFeaturedSheet() {
    featuredSheet.classList.remove('is-open')
    featuredSheet.setAttribute('aria-hidden', 'true')
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

  function openManagerHistorySheet() {
    managerHistorySheet.classList.add('is-open')
    managerHistorySheet.setAttribute('aria-hidden', 'false')
  }

  function closeManagerHistorySheet() {
    managerHistorySheet.classList.remove('is-open')
    managerHistorySheet.setAttribute('aria-hidden', 'true')
  }

  function formatHistoryNumber(value: number | null | undefined) {
    if (!Number.isFinite(Number(value))) return '—'
    return new Intl.NumberFormat('en-GB').format(Number(value))
  }

  async function loadManagerHistory(entryId: number, name: string) {
    managerHistoryTitleEl.textContent = `${name} — Season history`
    managerHistoryStatusEl.textContent = 'Loading history...'
    managerHistoryListEl.innerHTML = ''
    openManagerHistorySheet()

    try {
      const res = await fetch(`/api/fpl/entry/${entryId}/history`)
      if (!res.ok) throw new Error('History fetch failed')
      const data = await res.json()
      const past = Array.isArray(data?.past) ? data.past : []

      if (past.length === 0) {
        managerHistoryStatusEl.textContent = 'No season history found.'
        managerHistorySummaryEl.textContent = ''
        return
      }

      const sortedPast = [...past].sort((a: any, b: any) => {
        const ay = Number(String(a?.season_name ?? '').slice(0, 4)) || 0
        const by = Number(String(b?.season_name ?? '').slice(0, 4)) || 0
        return by - ay
      })

      function avgRankForLast(n: number) {
        const ranks = sortedPast.slice(0, n)
          .map((row: any) => Number(row?.rank))
          .filter((r: number) => Number.isFinite(r))
        if (ranks.length === 0) return '—'
        const avg = Math.round(ranks.reduce((sum, r) => sum + r, 0) / ranks.length)
        return formatHistoryNumber(avg)
      }

      const avg3 = avgRankForLast(3)
      const avg5 = avgRankForLast(5)

      managerHistorySummaryEl.innerHTML = `
        <div>Avg rank (last 3 seasons): <strong>${avg3}</strong></div>
        <div>Avg rank (last 5 seasons): <strong>${avg5}</strong></div>
      `

      managerHistoryStatusEl.textContent = ''
      managerHistoryListEl.innerHTML = sortedPast.map((row: any) => {
        const season = escapeHtml(String(row?.season_name ?? 'Unknown season'))
        const points = formatHistoryNumber(row?.total_points)
        const rank = formatHistoryNumber(row?.rank)

        return `
          <div class="manager-history-row">
            <div class="manager-history-col manager-history-col--season">${season}</div>
            <div class="manager-history-col manager-history-col--points">${points} pts</div>
            <div class="manager-history-col manager-history-col--rank">Rank ${rank}</div>
          </div>
        `
      }).join('')

    } catch (e) {
      console.error(e)
      managerHistoryStatusEl.textContent = 'Failed to load history. Please try again.'
    }
  }

  function parseTextareaIds(): number[] {
    const trimmed = textarea.value.trim()
    if (!trimmed) return []
    return trimmed
      .split(/[\s,]+/)
      .filter(x => x.match(/^\d+$/))
      .map(x => parseInt(x, 10))
  }

  // Manager Sources Sheet
  const managerSourcesOpenBtn = document.getElementById('manager-sources-open') as HTMLButtonElement
  const managerSourcesSheet = document.getElementById('manager-sources-sheet') as HTMLElement
  const managerSourcesCloseBtn = document.getElementById('manager-sources-close') as HTMLButtonElement
  const managerSourcesSearchInput = document.getElementById('manager-sources-search') as HTMLInputElement
  const managerSourcesListEl = document.getElementById('manager-sources-list') as HTMLElement

  type ManagerSourceInfo = {
    entryId: number
    name: string
    source: string
  }

  let allManagerSources: ManagerSourceInfo[] = []

  function openManagerSourcesSheet() {
    managerSourcesSheet.classList.add('is-open')
    managerSourcesSheet.setAttribute('aria-hidden', 'false')
  }

  function closeManagerSourcesSheet() {
    managerSourcesSheet.classList.remove('is-open')
    managerSourcesSheet.setAttribute('aria-hidden', 'true')
  }

  async function fetchManagerName(entryId: number): Promise<string> {
    try {
      const res = await fetch(`/api/fpl/entry/${entryId}/`)
      if (!res.ok) throw new Error('Entry lookup failed')
      const data = await res.json()
      const first = data?.player_first_name ?? ''
      const last = data?.player_last_name ?? ''
      const name = `${first} ${last}`.trim()
      return name || `Manager ${entryId}`
    } catch {
      return `Manager ${entryId}`
    }
  }

  async function fetchManagerImportSource(entryId: number): Promise<string> {
    // Check if it's a featured manager
    const isFeatured = featuredEntryIds.has(entryId)
    
    // Check if imported from a league
    const { data, error } = await supabase
      .from('user_league_imports')
      .select('league_id')
      .eq('user_id', currentUser.id)
      .eq('entry_id', entryId)
      .maybeSingle()

    if (!error && data?.league_id) {
      const leagueId = Number(data.league_id)
      const { data: leagueData } = await supabase
        .from('user_saved_leagues')
        .select('league_name')
        .eq('user_id', currentUser.id)
        .eq('league_id', leagueId)
        .maybeSingle()

      if (leagueData?.league_name) {
        return `Imported from: ${leagueData.league_name}`
      }

      return `Imported from: League ${leagueId}`
    }

    // If not from a league, check if featured
    if (isFeatured) {
      return 'Added from: Featured managers'
    }

    return 'Manually added'
  }

  async function loadManagerSources() {
    const ids = parseTextareaIds()
    if (ids.length === 0) {
      allManagerSources = []
      renderManagerSourcesList()
      return
    }

    managerSourcesListEl.innerHTML = `<div class="text-muted">Loading ${ids.length} managers...</div>`

    const results = await Promise.all(
      ids.map(async (entryId) => {
        const [name, source] = await Promise.all([
          fetchManagerName(entryId),
          fetchManagerImportSource(entryId)
        ])
        return { entryId, name, source }
      })
    )

    allManagerSources = results
    renderManagerSourcesList()
  }

  function renderManagerSourcesList() {
    const query = managerSourcesSearchInput?.value?.trim().toLowerCase() || ''

    const filtered = query
      ? allManagerSources.filter((m) => {
          const idStr = String(m.entryId).toLowerCase()
          const name = m.name.toLowerCase()
          const source = m.source.toLowerCase()
          return idStr.includes(query) || name.includes(query) || source.includes(query)
        })
      : allManagerSources

    if (filtered.length === 0) {
      managerSourcesListEl.innerHTML = `<div class="text-muted">No managers found</div>`
      return
    }

    managerSourcesListEl.innerHTML = filtered
      .map((m) => `
        <div class="manager-source-item">
          <div class="manager-source-item__header">
            <span class="manager-source-item__name">${escapeHtml(m.name)}</span>
            <span class="manager-source-item__id">${m.entryId}</span>
          </div>
          <div class="manager-source-item__footer">
            <span class="manager-source-item__source">${escapeHtml(m.source)}</span>
            <button type="button" class="manager-source-item__delete" data-entry-id="${m.entryId}" title="Remove manager">🗑️</button>
          </div>
        </div>
      `)
      .join('')

    // Attach delete handlers
    managerSourcesListEl
      .querySelectorAll<HTMLButtonElement>('.manager-source-item__delete')
      .forEach((btn) => {
        btn.addEventListener('click', async () => {
          const entryId = Number(btn.dataset.entryId)
          if (!Number.isFinite(entryId)) return
          
          if (!confirm(`Remove manager ${entryId} from your list?`)) return

          // Remove from textarea
          const currentIds = parseTextareaIds()
          const updatedIds = currentIds.filter(id => id !== entryId)
          textarea.value = updatedIds.join('\n')
          
          // Save to database
          const success = await saveManagerIds(updatedIds)
          if (success) {
            updateCount()
            // Reload the sources list
            await loadManagerSources()
          } else {
            alert('Failed to remove manager. Please try again.')
          }
        })
      })
  }

  managerSourcesOpenBtn?.addEventListener('click', () => {
    managerSourcesSearchInput.value = ''
    openManagerSourcesSheet()
    loadManagerSources()
  })

  managerSourcesCloseBtn?.addEventListener('click', () => {
    closeManagerSourcesSheet()
  })

  managerSourcesSearchInput?.addEventListener('input', () => {
    renderManagerSourcesList()
  })

  function updateFeaturedActions() {
    const current = new Set(parseTextareaIds())
    const toRemove = [...featuredEntryIds].filter((id) => current.has(id) && !selectedFeaturedIds.has(id))
    const toAdd = [...selectedFeaturedIds].filter((id) => !current.has(id))
    const hasDelta = toRemove.length > 0 || toAdd.length > 0

    featuredApplyBtn.disabled = !hasDelta
    featuredApplyBtn.textContent = 'Apply changes'

    featuredDeltaEl.textContent = hasDelta
      ? `${toAdd.length} add • ${toRemove.length} remove`
      : ''
  }

  function renderFeaturedList() {
    const query = featuredSearchInput?.value?.trim().toLowerCase() || ''

    const filtered = query
      ? featuredManagers.filter((m) => {
          const name = String(m.name ?? '').toLowerCase()
          const note = String(m.note ?? '').toLowerCase()
          const entryId = String(m.entryId ?? '').toLowerCase()
          return name.includes(query) || note.includes(query) || entryId.includes(query)
        })
      : featuredManagers

    featuredListEl.innerHTML = filtered.map((m) => {
      const safeName = escapeHtml(String(m.name ?? ''))
      const safeNote = m.note ? escapeHtml(String(m.note)) : ''
      const entryId = Number(m.entryId)
      const checked = selectedFeaturedIds.has(entryId) ? 'checked' : ''

      return `
        <label class="featured-item">
          <input type="checkbox" class="featured-check" data-id="${entryId}" ${checked} />
          <button
            type="button"
            class="featured-item__name featured-item__name-button"
            data-entry-id="${entryId}"
            data-name="${safeName}"
          >
            ${safeName}
          </button>
          ${safeNote ? `<span class="featured-item__note">— ${safeNote}</span>` : ``}
          <span class="featured-item__id">${safeNote ? `— ` : ``}<code>${entryId}</code></span>
        </label>
      `

    }).join('')

    featuredListEl.querySelectorAll<HTMLInputElement>('input.featured-check').forEach((cb) => {
      cb.addEventListener('change', () => {
        const id = parseInt(cb.dataset.id || '', 10)
        if (!Number.isFinite(id)) return

        if (cb.checked) selectedFeaturedIds.add(id)
        else selectedFeaturedIds.delete(id)

        updateFeaturedActions()
      })
    })

    featuredListEl.querySelectorAll<HTMLButtonElement>('button.featured-item__name-button').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()

        const entryId = Number(btn.dataset.entryId)
        if (!Number.isFinite(entryId)) return

        const managerName = btn.dataset.name ? String(btn.dataset.name) : `Manager ${entryId}`
        loadManagerHistory(entryId, managerName)
      })
    })
  }

  function clearFeaturedSelection() {
    selectedFeaturedIds.clear()
    featuredListEl.querySelectorAll<HTMLInputElement>('input.featured-check').forEach(cb => { cb.checked = false })
    updateFeaturedActions()
  }

  featuredOpenBtn?.addEventListener('click', () => {
    selectedFeaturedIds.clear()
    const current = new Set(parseTextareaIds())
    featuredEntryIds.forEach((id) => {
      if (current.has(id)) selectedFeaturedIds.add(id)
    })

    renderFeaturedList()
    featuredStatusEl.textContent = ''
    openFeaturedSheet()
    updateFeaturedActions()
  })

  featuredCloseBtn?.addEventListener('click', () => closeFeaturedSheet())
  managerHistoryCloseBtn?.addEventListener('click', () => closeManagerHistorySheet())

  featuredClearBtn?.addEventListener('click', () => {
    featuredStatusEl.textContent = ''
    clearFeaturedSelection()
  })

  featuredSearchInput?.addEventListener('input', () => {
    renderFeaturedList()
  })

  featuredApplyBtn?.addEventListener('click', async () => {
    syncSelectedFeaturedIdsFromDom()

    if (!isEditing) setEditMode(true)

    const current = new Set(parseTextareaIds())
    const toRemove = [...featuredEntryIds].filter((id) => current.has(id) && !selectedFeaturedIds.has(id))
    const toAdd = [...selectedFeaturedIds].filter((id) => !current.has(id))

    const next = new Set<number>(current)
    toRemove.forEach((id) => next.delete(id))
    toAdd.forEach((id) => next.add(id))

    if (next.size > MAX_MANAGERS) {
      const msg = `❌ Too many managers. Limit is ${MAX_MANAGERS}.`
      featuredStatusEl.textContent = msg
      featuredDeltaEl.textContent = ''
      status.innerHTML = `<p class='status status--error'>${msg}</p>`
      return
    }

    textarea.value = Array.from(next).join('\n') + '\n'
    updateCount()

    const saved = await saveManagerIds(Array.from(next))
    if (!saved) {
      const msg = '❌ Failed to save changes. Please try again.'
      featuredStatusEl.textContent = msg
      status.innerHTML = `<p class='status status--error'>${msg}</p>`
      return
    }

    setEditMode(false, { preserveStatus: true })

    let msg = ''
    if (toAdd.length > 0 && toRemove.length > 0) {
      msg = `✅ ${toAdd.length} added, ${toRemove.length} removed. Changes saved.`
    } else if (toAdd.length > 0) {
      msg = `✅ ${toAdd.length} added. Changes saved.`
    } else if (toRemove.length > 0) {
      msg = `✅ ${toRemove.length} removed. Changes saved.`
    } else {
      msg = 'No changes to apply.'
    }

    featuredStatusEl.textContent = msg
    status.innerHTML = `<p class='status ${msg.startsWith('✅') ? 'status--success' : 'status--warning'}'>${msg}</p>`

    updateFeaturedActions()
  })
  updateFeaturedActions()

  // =========================
  // League import
  // =========================

  const leagueOpenBtn = document.getElementById('league-open') as HTMLButtonElement
  const leagueSheet = document.getElementById('league-sheet') as HTMLElement
  const leagueCloseBtn = document.getElementById('league-close') as HTMLButtonElement
  const leagueIdInput = document.getElementById('league-id-input') as HTMLInputElement
  const leagueSaveBtn = document.getElementById('league-save') as HTMLButtonElement
  const leagueRefreshBtn = document.getElementById('league-refresh') as HTMLButtonElement
  const leagueStatusEl = document.getElementById('league-status') as HTMLElement
  const leagueListEl = document.getElementById('league-list') as HTMLElement

  const standingsSheet = document.getElementById('league-standings-sheet') as HTMLElement
  const standingsCloseBtn = document.getElementById('league-standings-close') as HTMLButtonElement
  const standingsTitleEl = document.getElementById('league-standings-title') as HTMLElement
  const standingsSubtitleEl = document.getElementById('league-standings-subtitle') as HTMLElement
  const standingsBannerEl = document.getElementById('league-standings-banner') as HTMLElement
  const standingsListEl = document.getElementById('league-standings-list') as HTMLElement
  const leagueSearchInput = document.getElementById('league-search') as HTMLInputElement
  const applyStatusEl = document.getElementById('league-apply-status') as HTMLElement
  const applySuccessEl = document.getElementById('league-apply-success') as HTMLElement
  const selectNoneBtn = document.getElementById('league-select-none') as HTMLButtonElement
  const applyBtn = document.getElementById('league-apply') as HTMLButtonElement

  type SavedLeague = { league_id: number; league_name: string | null }
  type StandingRow = { rank: number; entryId: number; entryName: string; playerName?: string | null }

  let activeLeague: { id: number; name: string | null } | null = null
  let activeStandings: StandingRow[] = []
  let activeSelectedEntryIds = new Set<number>()
  let previouslyImportedForActiveLeague = new Set<number>()
  let standingsSearchQuery = ''

  function syncActiveSelectedEntryIdsFromDom() {
    const next = new Set<number>()
    standingsListEl
      .querySelectorAll<HTMLInputElement>('input.league-check')
      .forEach((cb) => {
        const entryId = Number(cb.dataset.entryId)
        if (!Number.isFinite(entryId)) return
        if (cb.checked) next.add(entryId)
      })
    activeSelectedEntryIds = next
  }

  function openLeagueSheet() {
    leagueSheet.classList.add('is-open')
    leagueSheet.setAttribute('aria-hidden', 'false')
  }
  function closeLeagueSheet() {
    leagueSheet.classList.remove('is-open')
    leagueSheet.setAttribute('aria-hidden', 'true')
  }
  function openStandingsSheet() {
    standingsSheet.classList.add('is-open')
    standingsSheet.setAttribute('aria-hidden', 'false')
  }
  function closeStandingsSheet() {
    standingsSheet.classList.remove('is-open')
    standingsSheet.setAttribute('aria-hidden', 'true')
  }

  async function fetchLeagueMeta(leagueId: number) {
    const res = await fetch(`/api/fpl/league/${leagueId}`)
    if (!res.ok) throw new Error('League lookup failed')
    return await res.json() as { leagueId: number; leagueName: string | null }
  }

  async function fetchAllStandingsClassic(leagueId: number): Promise<{ leagueName: string | null; rows: StandingRow[] }> {
    let page = 1
    let all: StandingRow[] = []
    let leagueName: string | null = null

    while (true) {
      const res = await fetch(`/api/fpl/league/${leagueId}/standings?page=${page}`)
      if (!res.ok) throw new Error('Standings fetch failed')
      const data = await res.json() as any
      leagueName = leagueName ?? data?.league?.name ?? null
      const results = Array.isArray(data?.results) ? data.results : []
      all = all.concat(results)
      if (!data?.hasNext) break
      page++
      if (page > 50) break
    }

    all.sort((a, b) => a.rank - b.rank)
    return { leagueName, rows: all }
  }

  async function loadSavedLeagues() {
    leagueListEl.innerHTML = ''
    leagueStatusEl.textContent = ''

    const { data, error } = await supabase
      .from('user_saved_leagues')
      .select('league_id, league_name')
      .eq('user_id', currentUser.id)
      .order('updated_at', { ascending: false })

    if (error) {
      console.error(error)
      leagueStatusEl.textContent = 'Error loading saved leagues.'
      return
    }

    const leagues: SavedLeague[] = (data || []).map((x: any) => ({
      league_id: Number(x.league_id),
      league_name: x.league_name ? String(x.league_name) : null,
    }))

    if (leagues.length === 0) {
      leagueListEl.innerHTML = `<div class="text-muted">No saved leagues yet.</div>`
      return
    }

    leagueListEl.innerHTML = leagues.map((l) => {
      const name = l.league_name ? escapeHtml(l.league_name) : `League ${l.league_id}`
      return `
        <div class="featured-item saved-league-card">
          <div class="saved-league-title">
            <span class="featured-item__name">${name}</span>
            <span class="featured-item__note">— ID: <code>${l.league_id}</code></span>
          </div>

          <div class="saved-league-actions">
            <button type="button" class="btn btn--neutral" data-action="open" data-league-id="${l.league_id}">Open</button>
            <button type="button" class="btn btn--neutral" data-action="remove" data-league-id="${l.league_id}">Remove</button>
         </div>
        </div>

      `
    }).join('')

    leagueListEl.querySelectorAll<HTMLButtonElement>('button[data-action="open"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const leagueId = Number(btn.dataset.leagueId)
        await openLeagueStandings(leagueId)
      })
    })

    leagueListEl.querySelectorAll<HTMLButtonElement>('button[data-action="remove"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const leagueId = Number(btn.dataset.leagueId)
        const ok = confirm(`Remove league ${leagueId}? (This does not change your manager list yet.)`)
        if (!ok) return
        const { error } = await supabase
          .from('user_saved_leagues')
          .delete()
          .eq('user_id', currentUser.id)
          .eq('league_id', leagueId)
        if (error) {
          console.error(error)
          leagueStatusEl.textContent = 'Failed to remove league.'
          return
        }
        await supabase
          .from('user_league_imports')
          .delete()
          .eq('user_id', currentUser.id)
          .eq('league_id', leagueId)

        await loadSavedLeagues()
      })
    })
  }

  function parseLeagueIdFromInput(raw: string): number | null {
    const s = (raw ?? "").trim();
    if (!s) return null;

    if (/^\d+$/.test(s)) return Number(s);

    const m = s.match(/\/leagues\/(\d+)(?:\/|$)/i);
    if (m?.[1]) return Number(m[1]);

    const n = s.match(/\b(\d{3,})\b/);
    if (n?.[1]) return Number(n[1]);

    return null;
  }

  async function saveLeagueById() {
    leagueStatusEl.textContent = ''

    const leagueId = parseLeagueIdFromInput(leagueIdInput.value)
    if (!leagueId || !Number.isFinite(leagueId)) {
     leagueStatusEl.textContent = 'Paste a League ID (number) or league URL.'
     return
    }

    leagueSaveBtn.disabled = true
    try {
      const meta = await fetchLeagueMeta(leagueId)

      const { error } = await supabase
        .from('user_saved_leagues')
        .upsert({
          user_id: currentUser.id,
          league_id: leagueId,
          league_name: meta.leagueName,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,league_id' })

      if (error) throw error

      leagueStatusEl.textContent = `Saved: ${meta.leagueName || `League ${leagueId}`}`
      leagueIdInput.value = ''
      await loadSavedLeagues()
    } catch (e) {
      console.error(e)
      leagueStatusEl.textContent = 'Could not save. Check the league ID/URL and try again.'
    } finally {
      leagueSaveBtn.disabled = false
    }
  }

  async function loadPreviouslyImportedForLeague(leagueId: number) {
    const { data, error } = await supabase
      .from('user_league_imports')
      .select('entry_id')
      .eq('user_id', currentUser.id)
      .eq('league_id', leagueId)

    if (error) {
      console.error(error)
      return new Set<number>()
    }

    return new Set<number>((data || []).map((r: any) => Number(r.entry_id)))
  }

  async function leagueNamesByIds(leagueIds: number[]) {
    if (leagueIds.length === 0) return new Map<number, string>()
    const { data, error } = await supabase
      .from('user_saved_leagues')
      .select('league_id, league_name')
      .eq('user_id', currentUser.id)
      .in('league_id', leagueIds)

    if (error) {
      console.error(error)
      return new Map<number, string>()
    }

    const m = new Map<number, string>()
    for (const row of (data || []) as any[]) {
      m.set(Number(row.league_id), row.league_name ? String(row.league_name) : `League ${row.league_id}`)
    }
    return m
  }

  async function loadCrossLeagueInfoForEntries(entryIds: number[], excludeLeagueId: number) {
    const { data, error } = await supabase
      .from('user_league_imports')
      .select('entry_id, league_id')
      .eq('user_id', currentUser.id)
      .in('entry_id', entryIds)

    if (error) {
      console.error(error)
      return new Map<number, number[]>()
    }

    const map = new Map<number, number[]>()
    for (const row of (data || []) as any[]) {
      const entryId = Number(row.entry_id)
      const leagueId = Number(row.league_id)
      if (leagueId === excludeLeagueId) continue
      const arr = map.get(entryId) || []
      arr.push(leagueId)
      map.set(entryId, arr)
    }
    return map
  }

  function renderStandingsList() {
    const q = (standingsSearchQuery || '').trim().toLowerCase()

    const filtered = !q
      ? activeStandings
      : activeStandings.filter((r) => {
          const entryName = (r.entryName || '').toLowerCase()
          const playerName = (r.playerName || '').toLowerCase()
          const entryIdStr = String(r.entryId)
          return (
            entryName.includes(q) ||
            playerName.includes(q) ||
            entryIdStr.includes(q)
          )
        })

    standingsListEl.innerHTML = filtered.map((r) => {
      const checked = activeSelectedEntryIds.has(r.entryId) ? 'checked' : ''
      const safeEntryName = escapeHtml(r.entryName || '')
      const safePlayerName = r.playerName ? escapeHtml(r.playerName) : ''
      return `
        <label class="featured-item">
          <input type="checkbox" class="league-check" data-entry-id="${r.entryId}" ${checked} />
          <span class="featured-item__name">${safeEntryName}</span>
          ${safePlayerName ? `<span class="featured-item__note">— ${safePlayerName}</span>` : ``}
          <span class="featured-item__id"><code>${r.entryId}</code></span>
        </label>
    `
    }).join('')

    standingsListEl.querySelectorAll<HTMLInputElement>('input.league-check').forEach((cb) => {
      cb.addEventListener('change', async () => {
        const entryId = Number(cb.dataset.entryId)
        if (!Number.isFinite(entryId)) return

        if (cb.checked) activeSelectedEntryIds.add(entryId)
        else activeSelectedEntryIds.delete(entryId)

        await updateStandingsBannerAndWarnings()
      })
    })
  }

  async function updateStandingsBannerAndWarnings() {
    syncActiveSelectedEntryIdsFromDom()
    const currentManagerIds = new Set<number>(parseTextareaIds())

    const selected = [...activeSelectedEntryIds]
    const selectedCount = selected.length

    const leagueEntryIdSet = new Set<number>(activeStandings.map((r) => r.entryId))
    const toRemove = [...leagueEntryIdSet]
      .filter((id) => currentManagerIds.has(id) && !activeSelectedEntryIds.has(id))
    const toAdd = selected.filter((id) => !currentManagerIds.has(id))

    const totalAfter = currentManagerIds.size - toRemove.filter((id) => currentManagerIds.has(id)).length + toAdd.length
    const remaining = MAX_MANAGERS - totalAfter

    const hasDelta = (toRemove.length > 0) || (toAdd.length > 0)
    applyBtn.disabled = !hasDelta

    const allRelevant = Array.from(new Set([...toRemove, ...toAdd]))
    const crossLeagueIdsMap = await loadCrossLeagueInfoForEntries(allRelevant, activeLeague!.id)
    const otherLeagueIds = Array.from(new Set(Array.from(crossLeagueIdsMap.values()).flat()))
    const namesMap = await leagueNamesByIds(otherLeagueIds)

    const lines: string[] = []
    lines.push(`Selected in this league: ${selectedCount}`)
    lines.push(`Total after apply: ${totalAfter} / ${MAX_MANAGERS}`)
    lines.push(`Remaining slots after apply: ${remaining}`)

    const warnLines: string[] = []

    for (const id of toAdd) {
      const other = crossLeagueIdsMap.get(id) || []
      if (other.length > 0) {
        const leagues = other.map((lid) => namesMap.get(lid) || `League ${lid}`).join(', ')
        warnLines.push(`⚠️ EntryID ${id} is already selected in: ${leagues}.`)
      }
    }

    for (const id of toRemove) {
      const other = crossLeagueIdsMap.get(id) || []
      if (other.length > 0) {
        const leagues = other.map((lid) => namesMap.get(lid) || `League ${lid}`).join(', ')
        warnLines.push(`⚠️ EntryID ${id} is also selected in: ${leagues}. Unticking here will remove it from your manager list entirely.`)
      }
    }

    standingsBannerEl.innerHTML = lines.join(' • ')
    applyStatusEl.textContent = warnLines.join(' ')
  }

  async function openLeagueStandings(leagueId: number) {
    openStandingsSheet()
    applyStatusEl.textContent = ''
    applySuccessEl.textContent = ''
    standingsBannerEl.innerHTML = '<div class="loading-spinner"></div> Loading league standings...'
    standingsListEl.innerHTML = ''
    applyBtn.disabled = true

    closeLeagueSheet()

    try {
      const standings = await fetchAllStandingsClassic(leagueId)
      activeLeague = { id: leagueId, name: standings.leagueName }

      await supabase
        .from('user_saved_leagues')
        .upsert({
          user_id: currentUser.id,
          league_id: leagueId,
          league_name: standings.leagueName,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,league_id' })

      activeStandings = standings.rows

      standingsSearchQuery = ''
      if (leagueSearchInput) leagueSearchInput.value = ''

      previouslyImportedForActiveLeague = await loadPreviouslyImportedForLeague(leagueId)

      // Build a set of all EntryIDs in this league standings
      const leagueEntryIdSet = new Set<number>(activeStandings.map((r) => r.entryId))

      // Your current saved managers (manual + featured + any previous imports)
      const currentManagerIdSet = new Set<number>(parseTextareaIds())

      // Find managers you already have that are in this league
      const matchesFromCurrentList = new Set<number>()
      for (const id of currentManagerIdSet) {
        if (leagueEntryIdSet.has(id)) matchesFromCurrentList.add(id)
      }

      // Auto-select: union(previouslyImportedForActiveLeague, matchesFromCurrentList)
      activeSelectedEntryIds = new Set<number>([
        ...previouslyImportedForActiveLeague,
        ...matchesFromCurrentList,
      ])

      standingsTitleEl.textContent = standings.leagueName ? standings.leagueName : `League ${leagueId}`
      standingsSubtitleEl.textContent = `Tick/untick manager(s), then 'Apply changes'.`

      renderStandingsList()
      openStandingsSheet()
      await updateStandingsBannerAndWarnings()
    } catch (e) {
      console.error(e)
      standingsBannerEl.innerHTML = 'Failed to load standings. Check league ID and try again.'
      openStandingsSheet()
    }
  }

  async function applyLeagueChanges() {
    if (!activeLeague) return

    applyBtn.disabled = true
    selectNoneBtn.disabled = true

    try {
      if (!isEditing) setEditMode(true)

      // clear any old main-page message
      status.innerHTML = ''
      applySuccessEl.textContent = ''
      syncActiveSelectedEntryIdsFromDom()

      const current = new Set<number>(parseTextareaIds())

      const leagueEntryIdSet = new Set<number>(activeStandings.map((r) => r.entryId))
      const toRemove = [...leagueEntryIdSet]
        .filter((id) => current.has(id) && !activeSelectedEntryIds.has(id))
      const toAdd = [...activeSelectedEntryIds].filter((id) => !current.has(id))

      const next = new Set<number>(current)
      for (const id of toRemove) next.delete(id)
      for (const id of toAdd) next.add(id)

      if (next.size > MAX_MANAGERS) {
        const msg = `❌ Too many managers. Limit is ${MAX_MANAGERS}. Reduce your selection.`
        applyStatusEl.textContent = msg
        status.innerHTML = `<p class='status status--error'>${msg}</p>`
        return
      }

      // Update textarea (local) first
      textarea.value = Array.from(next).join('\n') + '\n'
      updateCount()

      // Update import mapping table to reflect current selection for this league
      if (toRemove.length > 0) {
        const { error } = await supabase
          .from('user_league_imports')
          .delete()
          .eq('user_id', currentUser.id)
          .eq('league_id', activeLeague.id)
          .in('entry_id', toRemove as any)

        if (error) throw error
      }

      if (activeSelectedEntryIds.size > 0) {
        const lookup = new Map<number, StandingRow>()
        activeStandings.forEach((r) => lookup.set(r.entryId, r))

        const payload = [...activeSelectedEntryIds].map((entryId) => {
          const row = lookup.get(entryId)
          return {
            user_id: currentUser.id,
            league_id: activeLeague!.id,
            entry_id: entryId,
            entry_name: row?.entryName || null,
            rank: row?.rank || null,
            updated_at: new Date().toISOString(),
          }
        })

        const { error } = await supabase
          .from('user_league_imports')
          .upsert(payload, { onConflict: 'user_id,league_id,entry_id' })

        if (error) throw error
      }

      // Sync "previously imported" set to the current selection
      previouslyImportedForActiveLeague = new Set<number>(activeSelectedEntryIds)
      const saved = await saveManagerIds(Array.from(next))
      if (!saved) throw new Error('Save failed')
      setEditMode(false, { preserveStatus: true })

      // Success message (once)
      const removedCount = toRemove.length
      const addedCount = toAdd.length

      let msg = ''
      if (addedCount > 0 && removedCount > 0) {
        msg = `✅ ${addedCount} manager(s) added and ${removedCount} removed. Changes saved.`
      } else if (addedCount > 0) {
        msg = `✅ ${addedCount} manager(s) added to your list. Changes saved.`
      } else if (removedCount > 0) {
        msg = `✅ ${removedCount} manager(s) removed from your list. Changes savded.`
      } else {
        msg = `No changes to apply.`
      }

      applySuccessEl.textContent = msg
      status.innerHTML = `<p class='status ${msg.startsWith('✅') ? 'status--success' : 'status--warning'}'>${msg}</p>`

      await updateStandingsBannerAndWarnings()
    } catch (e) {
      console.error(e)
      const msg = '❌ Failed to apply changes. Please try again.'
      applyStatusEl.textContent = msg
      status.innerHTML = `<p class='status status--error'>${msg}</p>`
    } finally {
      selectNoneBtn.disabled = false
      await updateStandingsBannerAndWarnings()
    }
  }

  leagueOpenBtn?.addEventListener('click', async () => {
    leagueStatusEl.textContent = ''
    openLeagueSheet()
    await loadSavedLeagues()
  })

  leagueCloseBtn?.addEventListener('click', () => closeLeagueSheet())
  leagueRefreshBtn?.addEventListener('click', async () => loadSavedLeagues())
  leagueSaveBtn?.addEventListener('click', async () => saveLeagueById())

  standingsCloseBtn?.addEventListener('click', () => {
    applySuccessEl.textContent = ''
    applyStatusEl.textContent = ''
    closeStandingsSheet()
  })

  leagueSearchInput?.addEventListener('input', () => {
    standingsSearchQuery = leagueSearchInput.value || ''
    renderStandingsList()
  })

  selectNoneBtn?.addEventListener('click', async () => {
    activeSelectedEntryIds.clear()
    standingsListEl.querySelectorAll<HTMLInputElement>('input.league-check').forEach((cb) => (cb.checked = false))
    await updateStandingsBannerAndWarnings()
  })

  applyBtn?.addEventListener('click', async () => {
    syncActiveSelectedEntryIdsFromDom()
    const current = new Set<number>(parseTextareaIds())
    const leagueEntryIdSet = new Set<number>(activeStandings.map((r) => r.entryId))
    const toRemove = [...leagueEntryIdSet]
      .filter((id) => current.has(id) && !activeSelectedEntryIds.has(id))
    if (toRemove.length > 0) {
      const ok = confirm(`Apply changes?\n\nThis will remove ${toRemove.length} manager(s) from your list if unticked here.`)
      if (!ok) return
    }
    await applyLeagueChanges()
  })

  checkAuth();

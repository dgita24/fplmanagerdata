import { supabase } from '../lib/supabase'
import { awaitAuthReady } from '../lib/authBootstrap'
import { checkAnalysisLabAccess } from '../lib/analysisAuth'

interface AnalysisGroup {
  id: string
  name: string
  season: string | null
  manager_ids: number[] | null
}

interface AnalysisMetricSelection {
  rankHistory: boolean
  transfers: boolean
  captaincy: boolean
  chipTiming: boolean
}

interface AnalysisRow {
  gw: number
  managerCount: number
  avgOverallRank: number | null
  avgEventTransfers: number | null
  hitRatePct: number | null
  captainTopElement: number | null
  captainTopPct: number | null
  chips: Record<string, number>
}

interface AnalysisResponse {
  group: {
    id: string
    name: string
    season: string | null
    managerCount: number
  }
  range: {
    startGw: number
    endGw: number
  }
  metrics: AnalysisMetricSelection
  rows: AnalysisRow[]
}

const loadingEl = document.getElementById('analysis-loading') as HTMLElement
const requireLoginEl = document.getElementById('analysis-require-login') as HTMLElement
const noAccessEl = document.getElementById('analysis-no-access') as HTMLElement
const appEl = document.getElementById('analysis-app') as HTMLElement

const formEl = document.getElementById('analysis-form') as HTMLFormElement
const groupSelectEl = document.getElementById('analysis-group') as HTMLSelectElement
const startGwEl = document.getElementById('analysis-start-gw') as HTMLInputElement
const endGwEl = document.getElementById('analysis-end-gw') as HTMLInputElement
const statusEl = document.getElementById('analysis-status') as HTMLElement
const resultsEl = document.getElementById('analysis-results') as HTMLElement
const runBtnEl = document.getElementById('analysis-run') as HTMLButtonElement

function setVisible(el: HTMLElement, visible: boolean) {
  el.style.display = visible ? '' : 'none'
}

function readMetrics(): AnalysisMetricSelection {
  const checked = new Set(
    Array.from(document.querySelectorAll<HTMLInputElement>('input[name="metric"]:checked')).map((el) => el.value)
  )

  return {
    rankHistory: checked.has('rankHistory'),
    transfers: checked.has('transfers'),
    captaincy: checked.has('captaincy'),
    chipTiming: checked.has('chipTiming'),
  }
}

function renderGroupOptions(groups: AnalysisGroup[], activeGroupId: string | null) {
  groupSelectEl.innerHTML = ''

  if (!groups.length) {
    const opt = document.createElement('option')
    opt.value = ''
    opt.textContent = 'No groups found'
    groupSelectEl.appendChild(opt)
    groupSelectEl.disabled = true
    runBtnEl.disabled = true
    statusEl.textContent = 'No analysis groups available for this user.'
    return
  }

  for (const group of groups) {
    const opt = document.createElement('option')
    opt.value = group.id
    const count = Array.isArray(group.manager_ids) ? group.manager_ids.length : 0
    const season = group.season ? ` • ${group.season}` : ''
    opt.textContent = `${group.name}${season} (${count} managers)`
    if (activeGroupId && group.id === activeGroupId) {
      opt.selected = true
    }
    groupSelectEl.appendChild(opt)
  }
}

function formatNumber(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat().format(Math.round(value))
}

function formatPct(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—'
  return `${value.toFixed(1)}%`
}

function renderResults(payload: AnalysisResponse) {
  if (!payload.rows.length) {
    resultsEl.innerHTML = `<p class="text-muted">No rows for GW ${payload.range.startGw} to ${payload.range.endGw}.</p>`
    return
  }

  const showRank = payload.metrics.rankHistory
  const showTransfers = payload.metrics.transfers
  const showCaptaincy = payload.metrics.captaincy
  const showChipTiming = payload.metrics.chipTiming

  const headers = ['GW', 'Managers']
  if (showRank) headers.push('Avg OR')
  if (showTransfers) headers.push('Avg Transfers', 'Hit Rate')
  if (showCaptaincy) headers.push('Top Captain', 'Captain %')
  if (showChipTiming) headers.push('Chips')

  const rowsHtml = payload.rows
    .map((row) => {
      const cells: string[] = []
      cells.push(`<td>${row.gw}</td>`)
      cells.push(`<td>${row.managerCount}</td>`)
      if (showRank) cells.push(`<td>${formatNumber(row.avgOverallRank)}</td>`)
      if (showTransfers) {
        cells.push(`<td>${formatNumber(row.avgEventTransfers)}</td>`)
        cells.push(`<td>${formatPct(row.hitRatePct)}</td>`)
      }
      if (showCaptaincy) {
        cells.push(`<td>${row.captainTopElement ? `#${row.captainTopElement}` : '—'}</td>`)
        cells.push(`<td>${formatPct(row.captainTopPct)}</td>`)
      }
      if (showChipTiming) {
        const chips = Object.entries(row.chips || {})
          .filter(([, count]) => Number(count) > 0)
          .map(([chip, count]) => `${chip}:${count}`)
          .join(', ')
        cells.push(`<td>${chips || '—'}</td>`)
      }

      return `<tr>${cells.join('')}</tr>`
    })
    .join('')

  const tableHead = headers.map((h) => `<th>${h}</th>`).join('')
  const maxAvgTransfers = Math.max(...payload.rows.map((r) => r.avgEventTransfers ?? 0), 0)
  const maxHitRate = Math.max(...payload.rows.map((r) => r.hitRatePct ?? 0), 0)

  const transferBars = showTransfers
    ? payload.rows
        .map((r) => {
          const val = r.avgEventTransfers ?? 0
          const width = maxAvgTransfers > 0 ? (val / maxAvgTransfers) * 100 : 0
          return `<div style="display:flex; align-items:center; gap:8px;"><span style="width:36px;">GW${r.gw}</span><div style="flex:1; background: var(--color-bg-soft, #f2f2f2); border-radius: 4px;"><div style="height:10px; width:${width.toFixed(1)}%; background: var(--color-primary, #3b82f6); border-radius: 4px;"></div></div><span style="width:52px; text-align:right;">${val.toFixed(1)}</span></div>`
        })
        .join('')
    : ''

  const hitRateBars = showTransfers
    ? payload.rows
        .map((r) => {
          const val = r.hitRatePct ?? 0
          const width = maxHitRate > 0 ? (val / maxHitRate) * 100 : 0
          return `<div style="display:flex; align-items:center; gap:8px;"><span style="width:36px;">GW${r.gw}</span><div style="flex:1; background: var(--color-bg-soft, #f2f2f2); border-radius: 4px;"><div style="height:10px; width:${width.toFixed(1)}%; background: var(--color-warning, #f59e0b); border-radius: 4px;"></div></div><span style="width:52px; text-align:right;">${val.toFixed(1)}%</span></div>`
        })
        .join('')
    : ''

  resultsEl.innerHTML = `
    <div class="text-muted" style="margin-bottom: var(--space-2);">
      Group: <strong>${payload.group.name}</strong> (${payload.group.managerCount} managers), GW ${payload.range.startGw}-${payload.range.endGw}
    </div>
    <div style="overflow-x: auto;">
      <table class="table table--compact" style="width: 100%; border-collapse: collapse;">
        <thead><tr>${tableHead}</tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    ${
      showTransfers
        ? `<div style="display:grid; gap: var(--space-3); grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); margin-top: var(--space-4);">
      <div>
        <div class="label" style="margin-bottom: var(--space-2);">Avg Transfers by GW</div>
        <div style="display:grid; gap:6px;">${transferBars}</div>
      </div>
      <div>
        <div class="label" style="margin-bottom: var(--space-2);">Hit Rate by GW</div>
        <div style="display:grid; gap:6px;">${hitRateBars}</div>
      </div>
    </div>`
        : ''
    }
  `
}

async function loadGroups() {
  const [{ data: groups, error: groupsError }, { data: settings, error: settingsError }] = await Promise.all([
    supabase
      .from('analysis_manager_groups')
      .select('id, name, season, manager_ids')
      .order('name', { ascending: true }),
    supabase
      .from('analysis_user_settings')
      .select('active_group_id')
      .single(),
  ])

  if (groupsError) {
    throw new Error(groupsError.message)
  }

  if (settingsError && settingsError.code !== 'PGRST116') {
    throw new Error(settingsError.message)
  }

  renderGroupOptions((groups || []) as AnalysisGroup[], settings?.active_group_id || null)
}

async function runAnalysis(evt: SubmitEvent) {
  evt.preventDefault()

  if (!groupSelectEl.value) return

  const startGw = Math.max(1, Math.min(38, Number(startGwEl.value) || 1))
  const endGw = Math.max(1, Math.min(38, Number(endGwEl.value) || 38))

  if (startGw > endGw) {
    statusEl.textContent = 'Start GW must be less than or equal to End GW.'
    return
  }

  const metrics = readMetrics()
  if (!Object.values(metrics).some(Boolean)) {
    statusEl.textContent = 'Select at least one metric.'
    return
  }

  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData?.session?.access_token

  if (!token) {
    statusEl.textContent = 'Session expired. Please log in again.'
    return
  }

  runBtnEl.disabled = true
  statusEl.textContent = 'Running analysis...'

  try {
    const res = await fetch('/api/analysis/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        groupId: groupSelectEl.value,
        startGw,
        endGw,
        metrics,
      }),
    })

    const payload = await res.json()
    if (!res.ok) {
      throw new Error(payload?.error || 'Analysis request failed')
    }

    renderResults(payload as AnalysisResponse)
    statusEl.textContent = 'Analysis complete.'
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Analysis failed'
    statusEl.textContent = message
  } finally {
    runBtnEl.disabled = false
  }
}

async function init() {
  const { user } = await awaitAuthReady()

  if (!user) {
    setVisible(loadingEl, false)
    setVisible(requireLoginEl, true)
    return
  }

  const hasAccess = await checkAnalysisLabAccess(user)
  if (!hasAccess) {
    setVisible(loadingEl, false)
    setVisible(noAccessEl, true)
    return
  }

  try {
    await loadGroups()
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to load groups'
    statusEl.textContent = message
  }

  formEl.addEventListener('submit', runAnalysis)

  setVisible(loadingEl, false)
  setVisible(appEl, true)
}

void init()

export type SupabaseConfig = {
  url: string
  anonKey: string
}

export type RuntimeEnv = {
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
}

export type RouteContext = {
  request: Request
  url: URL
  locals?: {
    runtime?: { env?: RuntimeEnv }
    env?: RuntimeEnv
  }
  platform?: {
    env?: RuntimeEnv
  }
}

export type SupabaseUser = {
  id: string
  email?: string
}

type AnalysisLabAccessRow = {
  user_id: string
}

type UserManagerListRow = {
  manager_ids: number[] | null
}

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

export function getBearerToken(request: Request): string | null {
  const auth = request.headers.get('authorization') || request.headers.get('Authorization')
  if (!auth?.toLowerCase().startsWith('bearer ')) return null
  return auth.slice(7).trim() || null
}

function pickEnv(ctx: RouteContext): RuntimeEnv | null {
  return (
    ctx?.locals?.runtime?.env ||
    ctx?.platform?.env ||
    ctx?.locals?.env ||
    null
  )
}

export function getSupabaseConfig(ctx: RouteContext): SupabaseConfig | null {
  const runtimeEnv = pickEnv(ctx)
  const url = runtimeEnv?.SUPABASE_URL || process.env.SUPABASE_URL || import.meta.env.SUPABASE_URL
  const anonKey = runtimeEnv?.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || import.meta.env.SUPABASE_ANON_KEY

  if (!url || !anonKey) return null
  return { url, anonKey }
}

export async function getSupabaseUser(token: string, config: SupabaseConfig): Promise<SupabaseUser | null> {
  const res = await fetch(`${config.url}/auth/v1/user`, {
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
    },
  })

  if (!res.ok) return null
  const data = await res.json()
  if (!data?.id) return null
  return { id: data.id, email: data.email }
}

export async function supabaseRestGet<T>(path: string, token: string, config: SupabaseConfig): Promise<T[]> {
  const res = await fetch(`${config.url}/rest/v1/${path}`, {
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  })

  if (!res.ok) {
    throw new Error(`Supabase REST error ${res.status}`)
  }

  return (await res.json()) as T[]
}

export async function getAuthorizedManagerIds(userId: string, token: string, config: SupabaseConfig): Promise<number[]> {
  const accessRows = await supabaseRestGet<AnalysisLabAccessRow>(
    `analysis_lab_access?select=user_id&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
    token,
    config
  )

  if (!Array.isArray(accessRows) || accessRows.length === 0) {
    throw new Error('ACCESS_DENIED')
  }

  const managerRows = await supabaseRestGet<UserManagerListRow>(
    `user_manager_lists?select=manager_ids&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
    token,
    config
  )

  return Array.isArray(managerRows?.[0]?.manager_ids)
    ? managerRows[0].manager_ids.map((id: unknown) => Number(id)).filter((id: number) => Number.isInteger(id) && id > 0)
    : []
}

export async function mapWithConcurrency<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  worker: (item: TIn) => Promise<TOut>
): Promise<TOut[]> {
  if (items.length === 0) return []
  const limit = Math.max(1, Math.min(concurrency, items.length))
  const results = new Array<TOut>(items.length)
  let nextIndex = 0

  const runners = Array.from({ length: limit }, async () => {
    while (true) {
      const index = nextIndex++
      if (index >= items.length) return
      results[index] = await worker(items[index])
    }
  })

  await Promise.all(runners)
  return results
}

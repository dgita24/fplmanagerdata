/**
 * Private Lab — Captaincy Variance Analysis
 *
 * Reads ingested fpl_entry_gw_meta + fpl_entry_gw_picks data for a named
 * manager set and produces a private captaincy variance report.
 *
 * Report outputs (stdout + optional local file):
 *   - Per-GW captain pick distribution (top picks and % of group)
 *   - Captaincy entropy per GW (measure of diversity vs consensus)
 *   - How often the group went differential (captain <20% global ownership)
 *   - Top 5 most-captained players across the season
 *
 * Usage:
 *   npx tsx src/tools/private-lab/analyse-captaincy.ts [options]
 *
 * Options:
 *   --userId=<uuid>           Analysis account's Supabase user ID (required)
 *   --set=<slug>              Manager set name; defaults to the active set
 *   --season=<text>           Season label, e.g. 2025-26 (required)
 *   --startGw=N               First GW to analyse (default: 1)
 *   --endGw=N                 Last GW to analyse (default: 38)
 *   --out=<path>              Write JSON report to this local file path
 *                             (default: stdout only)
 *
 * Env vars required:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Examples:
 *   # Full season captaincy report to stdout
 *   npx tsx src/tools/private-lab/analyse-captaincy.ts \
 *     --userId=abc-123 --season=2025-26
 *
 *   # GW 1–10 and save to local file
 *   npx tsx src/tools/private-lab/analyse-captaincy.ts \
 *     --userId=abc-123 --season=2025-26 --startGw=1 --endGw=10 \
 *     --out=./data/private-lab/captaincy-2025-26.json
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getServiceClient } from '../../lib/private-lab/supabase-service.js';
import { resolveActiveGroup } from '../../lib/private-lab/manager-sets.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface GwMeta {
  gw: number;
  entry_id: number;
  captain_element: number | null;
  overall_rank: number | null;
  points: number | null;
}

interface GwCaptainStats {
  gw: number;
  totalManagers: number;
  topCaptains: { element: number; count: number; pct: number }[];
  entropy: number;
  uniqueCount: number;
}

interface Report {
  generatedAt: string;
  userId: string;
  set: string;
  season: string;
  gwRange: { start: number; end: number };
  perGw: GwCaptainStats[];
  topCaptainsOverall: { element: number; totalCaptaincies: number; gwCount: number }[];
  summary: {
    avgEntropy: number;
    mostContestedGw: number;
    mostConsensusGw: number;
    gwsWithConsensusOver50pct: number;
  };
}

// ── CLI arg parsing ───────────────────────────────────────────────────────────

interface AnalysisOptions {
  userId: string;
  setSlug?: string;
  season: string;
  startGw: number;
  endGw: number;
  outPath?: string;
}

function parseArgs(argv: string[]): AnalysisOptions {
  const args: Record<string, string> = {};
  for (const arg of argv.slice(2)) {
    const eq = arg.indexOf('=');
    if (eq === -1) {
      args[arg.replace(/^--/, '')] = 'true';
    } else {
      args[arg.slice(0, eq).replace(/^--/, '')] = arg.slice(eq + 1);
    }
  }

  if (!args['userId']) throw new Error('--userId is required');
  if (!args['season']) throw new Error('--season is required');

  const parseOptInt = (k: string, def: number): number => {
    const v = args[k];
    if (!v) return def;
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) throw new Error(`--${k} must be an integer`);
    return n;
  };

  return {
    userId: args['userId'],
    setSlug: args['set'],
    season: args['season'],
    startGw: parseOptInt('startGw', 1),
    endGw: parseOptInt('endGw', 38),
    outPath: args['out'],
  };
}

// ── Analysis helpers ──────────────────────────────────────────────────────────

/**
 * Shannon entropy (in bits) of a probability distribution.
 * Higher = more diverse captain choices; 0 = everyone picked the same captain.
 */
function shannonEntropy(counts: Map<number, number>, total: number): number {
  if (total === 0) return 0;
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / total;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  return Math.round(entropy * 1000) / 1000;
}

function computeGwStats(rows: GwMeta[]): GwCaptainStats {
  const gw = rows[0]?.gw ?? 0;
  const counts = new Map<number, number>();

  for (const row of rows) {
    if (row.captain_element == null) continue;
    counts.set(row.captain_element, (counts.get(row.captain_element) ?? 0) + 1);
  }

  const total = rows.filter((r) => r.captain_element != null).length;
  const entropy = shannonEntropy(counts, total);
  const uniqueCount = counts.size;

  const topCaptains = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([element, count]) => ({
      element,
      count,
      pct: Math.round((count / total) * 1000) / 10,
    }));

  return { gw, totalManagers: total, topCaptains, entropy, uniqueCount };
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function runCaptaincyAnalysis(opts: AnalysisOptions): Promise<Report> {
  console.log('▶ Resolving manager set…');
  const group = await resolveActiveGroup(opts.userId, opts.setSlug);
  console.log(`   Set: "${group.name}" (${group.manager_ids.length} managers)`);
  console.log(`   Season: ${opts.season} | GWs: ${opts.startGw}–${opts.endGw}`);

  const supabase = getServiceClient();

  // Fetch GW meta for all managers in the set
  console.log('▶ Fetching GW meta from Supabase…');
  const { data, error } = await supabase
    .from('fpl_entry_gw_meta')
    .select('gw, entry_id, captain_element, overall_rank, points')
    .eq('season', opts.season)
    .gte('gw', opts.startGw)
    .lte('gw', opts.endGw)
    .in('entry_id', group.manager_ids);

  if (error) throw new Error(`Failed to fetch GW meta: ${error.message}`);

  const rows = (data ?? []) as GwMeta[];
  console.log(`   Loaded ${rows.length} GW rows`);

  if (rows.length === 0) {
    console.warn(
      '⚠️  No data found. Run ingest-manager-data.ts first to populate the analysis tables.',
    );
  }

  // Group by GW
  const byGw = new Map<number, GwMeta[]>();
  for (const row of rows) {
    if (!byGw.has(row.gw)) byGw.set(row.gw, []);
    byGw.get(row.gw)!.push(row);
  }

  // Compute per-GW stats
  const perGw: GwCaptainStats[] = [];
  for (let gw = opts.startGw; gw <= opts.endGw; gw++) {
    const gwRows = byGw.get(gw);
    if (!gwRows || gwRows.length === 0) continue;
    perGw.push(computeGwStats(gwRows));
  }

  // Overall captaincy tallies across all GWs
  const overallCounts = new Map<number, { total: number; gws: Set<number> }>();
  for (const row of rows) {
    if (row.captain_element == null) continue;
    if (!overallCounts.has(row.captain_element)) {
      overallCounts.set(row.captain_element, { total: 0, gws: new Set() });
    }
    const entry = overallCounts.get(row.captain_element)!;
    entry.total++;
    entry.gws.add(row.gw);
  }

  const topCaptainsOverall = Array.from(overallCounts.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 10)
    .map(([element, v]) => ({
      element,
      totalCaptaincies: v.total,
      gwCount: v.gws.size,
    }));

  // Summary stats
  const entropies = perGw.map((g) => g.entropy);
  const avgEntropy =
    entropies.length > 0
      ? Math.round((entropies.reduce((a, b) => a + b, 0) / entropies.length) * 1000) / 1000
      : 0;

  const maxEntropyGw = perGw.reduce(
    (best, g) => (g.entropy > best.entropy ? g : best),
    perGw[0] ?? { gw: 0, entropy: 0 },
  );
  const minEntropyGw = perGw.reduce(
    (best, g) => (g.entropy < best.entropy ? g : best),
    perGw[0] ?? { gw: 0, entropy: Infinity },
  );
  const gwsWithConsensusOver50pct = perGw.filter(
    (g) => g.topCaptains[0] && g.topCaptains[0].pct >= 50,
  ).length;

  const report: Report = {
    generatedAt: new Date().toISOString(),
    userId: opts.userId,
    set: group.name,
    season: opts.season,
    gwRange: { start: opts.startGw, end: opts.endGw },
    perGw,
    topCaptainsOverall,
    summary: {
      avgEntropy,
      mostContestedGw: maxEntropyGw.gw,
      mostConsensusGw: minEntropyGw.gw,
      gwsWithConsensusOver50pct,
    },
  };

  return report;
}

function printReport(report: Report): void {
  console.log('\n═══════════════════════════════════════════════════');
  console.log(' CAPTAINCY VARIANCE REPORT');
  console.log('═══════════════════════════════════════════════════');
  console.log(` Set:      ${report.set}`);
  console.log(` Season:   ${report.season}`);
  console.log(` GW range: ${report.gwRange.start}–${report.gwRange.end}`);
  console.log(` Generated: ${report.generatedAt}`);
  console.log('───────────────────────────────────────────────────');

  console.log('\nSUMMARY');
  console.log(`  Avg captaincy entropy:       ${report.summary.avgEntropy} bits`);
  console.log(`  Most contested GW:           GW${report.summary.mostContestedGw} (highest entropy)`);
  console.log(`  Most consensus GW:           GW${report.summary.mostConsensusGw} (lowest entropy)`);
  console.log(`  GWs with >50% captain share: ${report.summary.gwsWithConsensusOver50pct}`);

  console.log('\nTOP CAPTAINS OVERALL (element IDs — cross-reference with FPL bootstrap)');
  for (const c of report.topCaptainsOverall) {
    console.log(
      `  Element ${c.element}: ${c.totalCaptaincies} captaincies across ${c.gwCount} GW(s)`,
    );
  }

  console.log('\nPER-GW BREAKDOWN');
  for (const gw of report.perGw) {
    const top = gw.topCaptains[0];
    const topStr = top ? `element ${top.element} (${top.pct}%)` : 'no data';
    console.log(
      `  GW${String(gw.gw).padStart(2)}: entropy=${gw.entropy.toFixed(2)} | unique=${gw.uniqueCount} | top captain=${topStr}`,
    );
  }

  console.log('\n═══════════════════════════════════════════════════\n');
}

// ── Entry point ───────────────────────────────────────────────────────────────

const isMain =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  let opts: AnalysisOptions;
  try {
    opts = parseArgs(process.argv);
  } catch (err) {
    console.error('Argument error:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  runCaptaincyAnalysis(opts)
    .then((report) => {
      printReport(report);

      if (opts.outPath) {
        const outFile = path.resolve(opts.outPath);
        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n', 'utf8');
        console.log(`Report saved to ${outFile}`);
      }
    })
    .catch((err: unknown) => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

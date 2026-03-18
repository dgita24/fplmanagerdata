/**
 * Private Lab — Manage Named Manager Sets
 *
 * CLI tool for creating, updating, listing, and deleting named manager groups.
 * Uses the service-role Supabase client. No public UI.
 *
 * Usage:
 *   npx tsx src/tools/private-lab/manage-manager-set.ts <action> [options]
 *
 * Actions:
 *   upsert   Create or update a named manager set
 *   list     List all manager sets for a user
 *   delete   Delete a named manager set
 *
 * Options (upsert):
 *   --userId=<uuid>           The analysis account's Supabase user ID (required)
 *   --set=<slug>              Unique set name, e.g. top50-world-2025-26 (required)
 *   --ids=1,2,3,...           Comma-separated manager (entry) IDs (required, max 50)
 *   --description=<text>      Optional description
 *   --season=<text>           Optional season label, e.g. 2025-26
 *
 * Options (list, delete):
 *   --userId=<uuid>           The analysis account's Supabase user ID (required)
 *   --set=<slug>              Set name (required for delete)
 *
 * Env vars required:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Examples:
 *   # Create/update the world top 50 set
 *   npx tsx src/tools/private-lab/manage-manager-set.ts upsert \
 *     --userId=abc-123 --set=top50-world-2025-26 \
 *     --ids=123456,234567,345678 --season=2025-26
 *
 *   # List all sets for a user
 *   npx tsx src/tools/private-lab/manage-manager-set.ts list --userId=abc-123
 *
 *   # Delete a set
 *   npx tsx src/tools/private-lab/manage-manager-set.ts delete \
 *     --userId=abc-123 --set=top50-world-2025-26
 */

import { pathToFileURL } from 'node:url';
import {
  upsertManagerGroup,
  listManagerGroups,
  deleteManagerGroup,
} from '../../lib/private-lab/manager-sets.js';

// ── CLI arg parsing ───────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (const arg of argv.slice(2)) {
    const eq = arg.indexOf('=');
    if (eq === -1) {
      args[arg.replace(/^--/, '')] = 'true';
    } else {
      args[arg.slice(0, eq).replace(/^--/, '')] = arg.slice(eq + 1);
    }
  }
  return args;
}

function required(args: Record<string, string>, key: string): string {
  const v = args[key];
  if (!v) throw new Error(`--${key} is required`);
  return v;
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function actionUpsert(args: Record<string, string>): Promise<void> {
  const userId = required(args, 'userId');
  const name = required(args, 'set');
  const rawIds = required(args, 'ids');

  const managerIds = rawIds
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const n = parseInt(s, 10);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid manager ID: "${s}"`);
      return n;
    });

  if (managerIds.length === 0) throw new Error('--ids must contain at least one manager ID');
  if (managerIds.length > 50) throw new Error('--ids must contain at most 50 manager IDs');

  console.log(`Upserting manager set "${name}" with ${managerIds.length} managers…`);
  const group = await upsertManagerGroup(userId, name, managerIds, {
    description: args['description'],
    season: args['season'],
  });

  console.log(`✅ Done:`);
  console.log(`   id:          ${group.id}`);
  console.log(`   name:        ${group.name}`);
  console.log(`   season:      ${group.season ?? '(none)'}`);
  console.log(`   description: ${group.description ?? '(none)'}`);
  console.log(`   managers:    ${group.manager_ids.length}`);
  console.log(`   updated_at:  ${group.updated_at}`);
}

async function actionList(args: Record<string, string>): Promise<void> {
  const userId = required(args, 'userId');

  const groups = await listManagerGroups(userId);

  if (groups.length === 0) {
    console.log(`No manager sets found for user ${userId}`);
    return;
  }

  console.log(`Manager sets for user ${userId}:`);
  for (const g of groups) {
    console.log(`  • ${g.name}`);
    console.log(`      id:       ${g.id}`);
    console.log(`      season:   ${g.season ?? '(none)'}`);
    console.log(`      managers: ${g.manager_ids.length}`);
    console.log(`      updated:  ${g.updated_at}`);
    if (g.description) console.log(`      desc:     ${g.description}`);
  }
}

async function actionDelete(args: Record<string, string>): Promise<void> {
  const userId = required(args, 'userId');
  const name = required(args, 'set');

  console.log(`Deleting manager set "${name}"…`);
  await deleteManagerGroup(userId, name);
  console.log(`✅ Deleted manager set "${name}"`);
}

// ── Entry point ───────────────────────────────────────────────────────────────

const isMain =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const args = parseArgs(process.argv);
  const action = process.argv[2];

  if (!action || action.startsWith('--')) {
    console.error('Usage: manage-manager-set.ts <upsert|list|delete> [options]');
    process.exit(1);
  }

  // Remove the action from the parsed args view (it's positional)
  const actionMap: Record<string, (a: Record<string, string>) => Promise<void>> = {
    upsert: actionUpsert,
    list: actionList,
    delete: actionDelete,
  };

  const fn = actionMap[action];
  if (!fn) {
    console.error(`Unknown action "${action}". Use: upsert | list | delete`);
    process.exit(1);
  }

  fn(args).catch((err: unknown) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

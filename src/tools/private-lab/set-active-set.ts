/**
 * Private Lab — Set Active Manager Set
 *
 * CLI tool for marking a named manager group as the active default for a user.
 * Once set, ingestion and analysis scripts will use this group unless a specific
 * --set flag is passed.
 *
 * Usage:
 *   npx tsx src/tools/private-lab/set-active-set.ts [options]
 *
 * Options:
 *   --userId=<uuid>   The analysis account's Supabase user ID (required)
 *   --set=<slug>      The set name to mark as active (required)
 *
 * Env vars required:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Examples:
 *   # Make top50-world-2025-26 the active set
 *   npx tsx src/tools/private-lab/set-active-set.ts \
 *     --userId=abc-123 --set=top50-world-2025-26
 *
 *   # Switch to all-time set
 *   npx tsx src/tools/private-lab/set-active-set.ts \
 *     --userId=abc-123 --set=top50-all-time
 */

import { pathToFileURL } from 'node:url';
import { setActiveGroup } from '../../lib/private-lab/manager-sets.js';

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

const isMain =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const args = parseArgs(process.argv);

  const userId = args['userId'];
  const setName = args['set'];

  if (!userId) {
    console.error('Error: --userId is required');
    process.exit(1);
  }
  if (!setName) {
    console.error('Error: --set is required');
    process.exit(1);
  }

  console.log(`Setting active manager set to "${setName}" for user ${userId}…`);

  setActiveGroup(userId, setName)
    .then(() => {
      console.log(`✅ Active set is now "${setName}"`);
      console.log(`   Ingestion and analysis scripts will use this set by default.`);
    })
    .catch((err: unknown) => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

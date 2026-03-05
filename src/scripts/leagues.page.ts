// src/scripts/leagues.page.ts

// Assuming bootstrapped data includes `events` and `standings` structures
import { bootstrap } from './bootstrap';

const { events, standings } = bootstrap;

// Step 1: Compute latestGW
const latestGW = events.find(e => e.is_current) || activeEvent;  // Fallback to existing logic

// Step 2: Sort standings rows
const sortedStandings = standings.sort((a, b) => {
    if (b.projectedTotal === null && a.projectedTotal === null) {
        return a.total - b.total;  // Fallback to total desc
    }
    if (b.projectedTotal !== null && a.projectedTotal !== null) {
        if (b.projectedTotal !== a.projectedTotal) {
            return b.projectedTotal - a.projectedTotal;  // Sort by projectedTotal desc
        }
    }
    // Tie-break by liveGwPts desc, then by rank asc
    if (b.liveGwPts !== a.liveGwPts) {
        return b.liveGwPts - a.liveGwPts;
    }
    return a.rank - b.rank;
});

// The projectedTotal is rendered conditionally based on its presence
const renderStandings = sortedStandings.map(row => {
    return {
        ...row,
        projectedTotal: row.projectedTotal !== null ? row.projectedTotal : row.total // Avoid rendering projectedTotal when it is null
    };
});

// CurrentEntryId variable removed as it was unused
// Existing functionality remains intact, with added improvements.
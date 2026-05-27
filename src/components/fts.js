// FTs calculation utilities -- ported from your Excel logic

export function calculateFTs(managerHistory) {
  // Index manager GW data
  const byGW = new Map();
  managerHistory.forEach(row => byGW.set(row.gw, row));

  // Step 1: Calculate 'FTs Start of GW'
  for (let i = 0; i < managerHistory.length; ++i) {
    const row = managerHistory[i];
    const E = row.gw*1;
    let Q = 1;
    if (E === 1) {
      Q = 0;
    } else {
      const prevRow = byGW.get(E-1);
      if (!prevRow) {
        Q = 1;
      } else if (["WC","FH"].includes(prevRow.chipPlayed)) {
        Q = Math.max(1, prevRow.FTsStartOfGW - prevRow.transfers);
      } else {
        Q = Math.min(Math.max(1, prevRow.FTsStartOfGW - prevRow.transfers + 1), 5);
      }
    }
    row.FTsStartOfGW = Q;
  }

  // Step 2: FTs for next GW (max GW only)
  const maxGW = Math.max(...managerHistory.map(r => r.gw));
  managerHistory.forEach(row => {
    if (row.gw === maxGW) {
      const Q = row.FTsStartOfGW*1;
      const M = row.transfers*1;
      const F = row.chipPlayed;
      const inc = (F === "WC" || F === "FH") ? 0 : 1;
      row.FTsForNextGW = Math.min(Math.max(1, Q-M+inc), 5);
    } else {
      row.FTsForNextGW = "";
    }
  });
}

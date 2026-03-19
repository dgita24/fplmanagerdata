import fs from 'fs';
import path from 'path';

const LAB_DIR = path.join(process.cwd(), 'private', 'lab');
const REPORTS_DIR = path.join(LAB_DIR, 'reports');

// Ensure reports directory exists
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

console.log('════════════════════════════════════════');
console.log('  Lab Analysis: Generating Reports');
console.log('════════════════════════════════════════\n');

function generateTransferReports() {
  const transferDataPath = path.join(LAB_DIR, 'transfer-strategy.json');
  if (!fs.existsSync(transferDataPath)) {
    console.log('⚠️ transfer-strategy.json not found. Skipping.');
    return;
  }

  const data = JSON.parse(fs.readFileSync(transferDataPath, 'utf-8'));
  
  // 1. Generate CSV: Manager Aggressiveness & Hit Rates
  let managerCsv = 'Entry ID,GWs Played,Total Hits,Hits per GW,Kneejerk Count,Patient Count,Kneejerk Rate %,Aggressiveness\n';
  
  // 2. Generate CSV: Every Premium Sell (for pivot tables)
  let sellsCsv = 'Entry ID,GW,Element ID,Player Name,Sell Price,Blanks Before Sell,Is Kneejerk\n';
  
  const playerSellCounts: Record<string, number> = {};

  data.manager_results.forEach((m: any) => {
    managerCsv += `${m.entry_id},${m.gws_played},${m.total_hits},${m.hits_per_gw},${m.kneejerk_count},${m.patient_count},${m.kneejerk_rate_pct},${m.aggressiveness}\n`;
    
    m.premium_sells.forEach((sell: any) => {
      sellsCsv += `${m.entry_id},${sell.gw},${sell.element_out},${sell.element_name},${sell.sell_price},${sell.blanks_before_sell},${sell.is_kneejerk}\n`;
      
      // Track player sell counts for the markdown summary
      playerSellCounts[sell.element_name] = (playerSellCounts[sell.element_name] || 0) + 1;
    });
  });

  fs.writeFileSync(path.join(REPORTS_DIR, 'manager-aggressiveness.csv'), managerCsv);
  fs.writeFileSync(path.join(REPORTS_DIR, 'premium-sells.csv'), sellsCsv);

  // 3. Generate Markdown Summary segment
  const sortedSells = Object.entries(playerSellCounts).sort((a, b) => b[1] - a[1]);
  
  const mdSummary = `
# FPL Lab Analysis Summary
*Generated at: ${new Date().toISOString().split('T')[0]}*

## 🔄 Transfer Strategy & Patience

**Group Overview:**
- **Analyzed Managers:** ${data.manager_count}
- **Average hits per GW:** ${data.cross_group.avg_hits_per_gw}
- **Group Kneejerk Rate:** ${data.cross_group.kneejerk_rate_pct}% *(Premium sells after <= 2 blanks)*

**Most Sold Premium Players (Group wide):**
${sortedSells.map(([player, count]) => `- **${player}**: ${count} times`).join('\n')}

---
`;

  fs.writeFileSync(path.join(REPORTS_DIR, 'lab-summary.md'), mdSummary);
  
  console.log('✅ Generated manager-aggressiveness.csv');
  console.log('✅ Generated premium-sells.csv');
  console.log('✅ Generated lab-summary.md');
}

// Run the report generation
generateTransferReports();
// We can easily add generateCaptaincyReports(), generateChipReports(), etc. here next!

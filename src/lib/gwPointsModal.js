/**
 * Shared GW Points Modal Module
 * Displays player gameweek-by-gameweek FPL points in a modal
 */

/**
 * Inject global CSS styles for GW Points table
 * This ensures styles work even when parent page has scoped CSS
 */
function injectGWPointsStyles() {
  // Check if styles already injected
  if (document.getElementById('gw-points-modal-styles')) {
    return;
  }

  const styleEl = document.createElement('style');
  styleEl.id = 'gw-points-modal-styles';
  styleEl.textContent = `
    .gw-points-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--color-text);
      margin-bottom: var(--space-3);
      text-align: center;
    }

    .gw-points-table-wrapper {
      max-height: 60vh;
      overflow-y: auto;
      overflow-x: auto;
    }

    .gw-points-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      min-width: 280px;
    }

    .gw-points-table thead {
      background: var(--color-surface-alt);
      position: sticky;
      top: 0;
      z-index: 1;
    }

    .gw-points-table th {
      padding: var(--space-2) var(--space-1);
      text-align: center;
      font-weight: 600;
      color: var(--color-text-secondary);
      border-bottom: 2px solid var(--color-border);
      border-right: 1px solid var(--color-border);
    }

    .gw-points-table th:last-child {
      border-right: none;
    }

    .gw-points-table td {
      padding: var(--space-2) var(--space-1);
      border-bottom: 1px solid var(--color-border);
      border-right: 1px solid var(--color-border);
      text-align: center;
    }

    .gw-points-table td:last-child {
      border-right: none;
    }

    .gw-points-table tbody tr:hover {
      background: var(--color-surface-alt);
    }

    /* Column-specific styles */
    .gw-points-table .gw-col {
      font-weight: 600;
      width: 15%;
      min-width: 40px;
    }

    .gw-points-table .opp-col {
      width: 40%;
      min-width: 90px;
    }

    .gw-points-table .mins-col {
      width: 20%;
      min-width: 50px;
    }

    .gw-points-table .pts-col {
      width: 25%;
      min-width: 60px;
      font-weight: 600;
    }

    .gw-points-table .points-positive {
      color: var(--color-success);
    }

    .gw-points-table .points-negative {
      color: var(--color-danger);
    }

    /* Mobile optimization */
    @media (max-width: 480px) {
      .gw-points-table {
        font-size: 12px;
        min-width: 260px;
      }

      .gw-points-table th,
      .gw-points-table td {
        padding: var(--space-1) 4px;
      }

      .gw-points-title {
        font-size: 16px;
        margin-bottom: var(--space-2);
      }
    }

    .gw-points-loading,
    .gw-points-error,
    .gw-points-empty {
      padding: var(--space-4);
      text-align: center;
    }

    .gw-points-loading-text,
    .gw-points-error-text,
    .gw-points-empty-text {
      color: var(--color-text-secondary);
      margin-top: var(--space-2);
    }

    .gw-points-error-details {
      color: var(--color-danger);
      font-size: 12px;
      margin-top: var(--space-1);
    }
  `;
  
  document.head.appendChild(styleEl);
}

export function initGWPointsModal(modalId = 'gw-points-modal') {
  const modal = document.getElementById(modalId);
  if (!modal) {
    console.error(`GW Points Modal with id "${modalId}" not found`);
    return;
  }

  const modalContent = modal.querySelector('.gw-points-modal-content');
  const closeBtn = modal.querySelector('.modal-close');

  // Inject global styles for the GW points table (needed for live.astro where CSS is scoped)
  // This ensures styles apply to dynamically injected modal content
  injectGWPointsStyles();

  // Close button handler
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      modal.classList.remove('is-open');
    });
  }

  // ESC key handler
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('is-open')) {
      modal.classList.remove('is-open');
    }
  });

  // Click outside to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('is-open');
    }
  });

  /**
   * Fetch player GW history from FPL API
   */
  async function fetchPlayerGWHistory(playerId, teamCache) {
    try {
      const response = await fetch(`/api/fpl/element-summary/${playerId}/`);
      if (!response.ok) {
        throw new Error(`Failed to fetch player data: ${response.status}`);
      }
      const data = await response.json();
      const history = data.history || [];
      
      // Enrich with team short names if teamCache is provided
      if (teamCache) {
        return history.map(gw => {
          // Ensure opponent_team is a number to match teamCache key type
          const opponentTeamId = Number(gw.opponent_team);
          const team = teamCache.get(opponentTeamId);
          const shortName = typeof team === 'string' ? team : team?.shortName;
          return {
            ...gw,
            opponent_team_short: shortName || gw.opponent_team
          };
        });
      }
      
      return history;
    } catch (error) {
      console.error('Error fetching player GW history:', error);
      throw error;
    }
  }

  /**
   * Show loading state
   */
  function showLoading(playerName) {
    modalContent.innerHTML = `
      <div class="gw-points-loading">
        <h2 class="gw-points-title">${playerName} - GW Points</h2>
        <p class="gw-points-loading-text">Loading gameweek data...</p>
      </div>
    `;
  }

  /**
   * Show error state
   */
  function showError(playerName, error) {
    modalContent.innerHTML = `
      <div class="gw-points-error">
        <h2 class="gw-points-title">${playerName} - GW Points</h2>
        <p class="gw-points-error-text">Failed to load gameweek data.</p>
        <p class="gw-points-error-details">${error.message}</p>
      </div>
    `;
  }

  /**
   * Render GW points table
   */
  function renderGWPointsTable(playerName, gwHistory) {
    if (!gwHistory || gwHistory.length === 0) {
      modalContent.innerHTML = `
        <div class="gw-points-empty">
          <h2 class="gw-points-title">${playerName} - GW Points</h2>
          <p class="gw-points-empty-text">No gameweek data available.</p>
        </div>
      `;
      return;
    }

    // Sort by gameweek (round field) - newest first
    const sortedHistory = [...gwHistory].sort((a, b) => b.round - a.round);

    // Single scrollable table
    let tableHTML = `
      <h2 class="gw-points-title">${playerName} - GW Points</h2>
      <div class="gw-points-table-wrapper">
        <table class="gw-points-table">
          <thead>
            <tr>
              <th class="gw-col">GW</th>
              <th class="opp-col">Opponent</th>
              <th class="mins-col">Mins</th>
              <th class="pts-col">Points</th>
            </tr>
          </thead>
          <tbody>
    `;

    sortedHistory.forEach(gw => {
      const opponent = gw.opponent_team_short || gw.opponent_team || '—';
      const wasHome = gw.was_home;
      // Format: 3-letter code (H) or (A)
      const opponentStr = `${opponent} ${wasHome ? '(H)' : '(A)'}`;
      const minutes = gw.minutes || 0;
      const points = gw.total_points || 0;
      const pointsClass = points > 0 ? 'points-positive' : (points < 0 ? 'points-negative' : '');
      
      tableHTML += `
        <tr>
          <td class="gw-col">${gw.round}</td>
          <td class="opp-col">${opponentStr}</td>
          <td class="mins-col">${minutes}</td>
          <td class="pts-col ${pointsClass}">${points}</td>
        </tr>
      `;
    });

    tableHTML += `
          </tbody>
        </table>
      </div>
    `;
    
    modalContent.innerHTML = tableHTML;
  }

  /**
   * Open the GW points modal for a player
   * @param {number} playerId - FPL player element ID
   * @param {string} playerName - Player display name
   * @param {Map} teamCache - Optional team cache for team short names
   */
  async function openGWPointsModal(playerId, playerName, teamCache = null) {
    showLoading(playerName);
    modal.classList.add('is-open');

    try {
      const gwHistory = await fetchPlayerGWHistory(playerId, teamCache);
      renderGWPointsTable(playerName, gwHistory);
    } catch (error) {
      showError(playerName, error);
    }
  }

  // Return public API
  return {
    open: openGWPointsModal
  };
}

/**
 * Make player name clickable and attach GW points modal handler
 */
export function makePlayerNameClickable(playerNameElement, playerId, playerName, gwPointsModal, teamCache = null) {
  if (!playerNameElement) return;

  playerNameElement.style.cursor = 'pointer';
  playerNameElement.style.color = 'var(--color-warning)'; // Use warning color (yellow/gold)
  playerNameElement.dataset.playerId = playerId;
  playerNameElement.dataset.playerName = playerName;

  // Remove existing listener if any
  const newElement = playerNameElement.cloneNode(true);
  playerNameElement.parentNode.replaceChild(newElement, playerNameElement);

  newElement.addEventListener('click', (e) => {
    e.stopPropagation();
    gwPointsModal.open(playerId, playerName, teamCache);
  });

  return newElement;
}

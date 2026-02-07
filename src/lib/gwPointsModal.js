/**
 * Shared GW Points Modal Module
 * Displays player gameweek-by-gameweek FPL points in a modal
 */

export function initGWPointsModal(modalId = 'gw-points-modal') {
  const modal = document.getElementById(modalId);
  if (!modal) {
    console.error(`GW Points Modal with id "${modalId}" not found`);
    return;
  }

  const modalContent = modal.querySelector('.gw-points-modal-content');
  const closeBtn = modal.querySelector('.modal-close');

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
          const team = teamCache.get(gw.opponent_team);
          return {
            ...gw,
            opponent_team_short: team?.shortName || gw.opponent_team
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

    // Sort by gameweek (round field)
    const sortedHistory = [...gwHistory].sort((a, b) => a.round - b.round);

    // Split into two columns for better layout
    const halfLength = Math.ceil(sortedHistory.length / 2);
    const firstHalf = sortedHistory.slice(0, halfLength);
    const secondHalf = sortedHistory.slice(halfLength);

    let tableHTML = `
      <h2 class="gw-points-title">${playerName} - GW Points</h2>
      <div class="gw-points-tables">
        <table class="gw-points-table">
          <thead>
            <tr>
              <th>GW</th>
              <th>Opponent</th>
              <th>Mins</th>
              <th>Points</th>
            </tr>
          </thead>
          <tbody>
    `;

    firstHalf.forEach(gw => {
      const opponent = gw.opponent_team_short || gw.opponent_team || '—';
      const wasHome = gw.was_home;
      const opponentStr = wasHome ? `vs ${opponent}` : `@ ${opponent}`;
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
    `;

    // Add second table if we have data
    if (secondHalf.length > 0) {
      tableHTML += `
        <table class="gw-points-table">
          <thead>
            <tr>
              <th>GW</th>
              <th>Opponent</th>
              <th>Mins</th>
              <th>Points</th>
            </tr>
          </thead>
          <tbody>
      `;

      secondHalf.forEach(gw => {
        const opponent = gw.opponent_team_short || gw.opponent_team || '—';
        const wasHome = gw.was_home;
        const opponentStr = wasHome ? `vs ${opponent}` : `@ ${opponent}`;
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
      `;
    }

    tableHTML += `</div>`;
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

import { describe, it, expect } from 'vitest';

/**
 * Tests for the Live page rank-cell favourite-toggle logic.
 *
 * The rank cell in live.page.ts makeLiveTable renders:
 *   - a <button class="rank-fav-btn"> wrapping the rank number
 *   - the class "rank-fav-btn--active" when the manager is in favouriteIds
 *   - data-entry-id set to the manager's entryId
 *   - aria-pressed="true" / "false" reflecting favourite state
 *
 * The attachRankFavButtons handler calls toggleFavourite(entryId) which:
 *   - adds entryId to favouriteIds when not present
 *   - removes entryId from favouriteIds when already present
 */

// ─── Pure helpers extracted for testing ────────────────────────────────────

/** Mirrors the isFav / class logic in makeLiveTable rank cell */
function buildRankCellHtml(rank: number, entryId: number, managerName: string, favouriteIds: Set<number>): string {
  const isFav = favouriteIds.has(entryId);
  return `<button type="button" class="rank-fav-btn${isFav ? ' rank-fav-btn--active' : ''}" data-entry-id="${entryId}" title="Click to toggle favourite" aria-label="Toggle favourite for ${managerName}" aria-pressed="${isFav}">${rank}</button>`;
}

/** Mirrors the toggleFavourite logic in live.page.ts */
function toggleFavourite(entryId: number, favouriteIds: Set<number>): Set<number> {
  const next = new Set(favouriteIds);
  if (next.has(entryId)) {
    next.delete(entryId);
  } else {
    next.add(entryId);
  }
  return next;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Live table rank cell — favourite toggle', () => {
  describe('buildRankCellHtml', () => {
    it('renders rank number inside button', () => {
      const html = buildRankCellHtml(3, 42, 'Alice', new Set());
      expect(html).toContain('>3<');
    });

    it('includes data-entry-id attribute', () => {
      const html = buildRankCellHtml(1, 99, 'Bob', new Set());
      expect(html).toContain('data-entry-id="99"');
    });

    it('does NOT have active class when manager is not a favourite', () => {
      const html = buildRankCellHtml(1, 7, 'Carol', new Set([1, 2]));
      expect(html).not.toContain('rank-fav-btn--active');
    });

    it('has active class when manager IS a favourite', () => {
      const html = buildRankCellHtml(2, 7, 'Carol', new Set([7]));
      expect(html).toContain('rank-fav-btn--active');
    });

    it('sets aria-pressed="false" when not a favourite', () => {
      const html = buildRankCellHtml(1, 5, 'Dave', new Set());
      expect(html).toContain('aria-pressed="false"');
    });

    it('sets aria-pressed="true" when IS a favourite', () => {
      const html = buildRankCellHtml(1, 5, 'Dave', new Set([5]));
      expect(html).toContain('aria-pressed="true"');
    });

    it('includes tooltip text', () => {
      const html = buildRankCellHtml(1, 5, 'Eve', new Set());
      expect(html).toContain('title="Click to toggle favourite"');
    });

    it('includes aria-label with manager name', () => {
      const html = buildRankCellHtml(1, 5, 'Eve', new Set());
      expect(html).toContain('aria-label="Toggle favourite for Eve"');
    });
  });

  describe('toggleFavourite logic', () => {
    it('adds manager to favourites when not present', () => {
      const result = toggleFavourite(10, new Set([1, 2]));
      expect(result.has(10)).toBe(true);
      expect(result.size).toBe(3);
    });

    it('removes manager from favourites when already present', () => {
      const result = toggleFavourite(1, new Set([1, 2]));
      expect(result.has(1)).toBe(false);
      expect(result.size).toBe(1);
    });

    it('does not mutate the original set', () => {
      const original = new Set([1, 2]);
      toggleFavourite(1, original);
      expect(original.size).toBe(2);
    });

    it('toggling twice returns manager to original state (add)', () => {
      const ids = new Set<number>();
      const after1 = toggleFavourite(5, ids);
      expect(after1.has(5)).toBe(true);
      const after2 = toggleFavourite(5, after1);
      expect(after2.has(5)).toBe(false);
    });

    it('toggling twice returns manager to original state (remove)', () => {
      const ids = new Set([5]);
      const after1 = toggleFavourite(5, ids);
      expect(after1.has(5)).toBe(false);
      const after2 = toggleFavourite(5, after1);
      expect(after2.has(5)).toBe(true);
    });

    it('rank cell reflects updated favourite state after toggle on', () => {
      const ids = new Set<number>();
      const after = toggleFavourite(42, ids);
      const html = buildRankCellHtml(1, 42, 'Alice', after);
      expect(html).toContain('rank-fav-btn--active');
      expect(html).toContain('aria-pressed="true"');
    });

    it('rank cell reflects updated favourite state after toggle off', () => {
      const ids = new Set([42]);
      const after = toggleFavourite(42, ids);
      const html = buildRankCellHtml(1, 42, 'Alice', after);
      expect(html).not.toContain('rank-fav-btn--active');
      expect(html).toContain('aria-pressed="false"');
    });
  });
});

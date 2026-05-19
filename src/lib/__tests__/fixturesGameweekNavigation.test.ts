import { describe, expect, it } from "vitest";
import {
  getAvailableGameweeks,
  getGameweekNeighbors,
  resolveGameweekSelection,
} from "../fixturesGameweekNavigation";

describe("fixtures gameweek navigation helpers", () => {
  it("returns sorted, unique and valid gameweeks", () => {
    expect(getAvailableGameweeks(["", "3", "abc", "1", "3", "2"])).toEqual([1, 2, 3]);
  });

  it("resolves selected gameweek and clamps out-of-range values", () => {
    const available = [1, 2, 3, 4];
    expect(resolveGameweekSelection(available, 3)).toBe(3);
    expect(resolveGameweekSelection(available, 0)).toBe(1);
    expect(resolveGameweekSelection(available, 99)).toBe(4);
    expect(resolveGameweekSelection(available, null)).toBeNull();
  });

  it("returns previous/next neighbors with safe boundaries", () => {
    const available = [1, 2, 3];
    expect(getGameweekNeighbors(available, 1)).toEqual({ previous: null, next: 2 });
    expect(getGameweekNeighbors(available, 2)).toEqual({ previous: 1, next: 3 });
    expect(getGameweekNeighbors(available, 3)).toEqual({ previous: 2, next: null });
  });
});

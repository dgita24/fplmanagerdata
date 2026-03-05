import { describe, it, expect } from 'vitest';
import { aggregateTransferSummary } from '../transferSummary';
import type { FplTransfer } from '../transferSummary';

describe('aggregateTransferSummary', () => {
  it('returns empty arrays when transfers list is empty', () => {
    const result = aggregateTransferSummary([], 1);
    expect(result.transferredIn).toEqual([]);
    expect(result.transferredOut).toEqual([]);
  });

  it('filters out transfers that do not match the requested GW', () => {
    const transfers: FplTransfer[] = [
      { event: 1, element_in: 10, element_out: 20 },
      { event: 2, element_in: 11, element_out: 21 },
    ];
    const result = aggregateTransferSummary(transfers, 1);
    expect(result.transferredIn).toEqual([{ playerId: 10, count: 1 }]);
    expect(result.transferredOut).toEqual([{ playerId: 20, count: 1 }]);
  });

  it('counts each player correctly across multiple managers', () => {
    const transfers: FplTransfer[] = [
      { event: 3, element_in: 100, element_out: 200 },
      { event: 3, element_in: 100, element_out: 201 },
      { event: 3, element_in: 101, element_out: 200 },
    ];
    const result = aggregateTransferSummary(transfers, 3);
    // player 100 in twice, player 101 in once
    expect(result.transferredIn[0]).toEqual({ playerId: 100, count: 2 });
    expect(result.transferredIn[1]).toEqual({ playerId: 101, count: 1 });
    // player 200 out twice, player 201 out once
    expect(result.transferredOut[0]).toEqual({ playerId: 200, count: 2 });
    expect(result.transferredOut[1]).toEqual({ playerId: 201, count: 1 });
  });

  it('sorts results by count descending', () => {
    const transfers: FplTransfer[] = [
      { event: 5, element_in: 1, element_out: 10 },
      { event: 5, element_in: 2, element_out: 10 },
      { event: 5, element_in: 2, element_out: 11 },
      { event: 5, element_in: 3, element_out: 10 },
      { event: 5, element_in: 3, element_out: 11 },
      { event: 5, element_in: 3, element_out: 12 },
    ];
    const result = aggregateTransferSummary(transfers, 5);
    expect(result.transferredIn.map(r => r.count)).toEqual([3, 2, 1]);
    expect(result.transferredOut.map(r => r.count)).toEqual([3, 2, 1]);
  });

  it('handles ties in count by sorting by playerId ascending', () => {
    const transfers: FplTransfer[] = [
      { event: 1, element_in: 50, element_out: 60 },
      { event: 1, element_in: 40, element_out: 70 },
    ];
    const result = aggregateTransferSummary(transfers, 1);
    // Both have count=1; lower playerId first
    expect(result.transferredIn[0].playerId).toBe(40);
    expect(result.transferredIn[1].playerId).toBe(50);
  });

  it('returns empty when no transfers match the requested GW', () => {
    const transfers: FplTransfer[] = [
      { event: 2, element_in: 10, element_out: 20 },
    ];
    const result = aggregateTransferSummary(transfers, 99);
    expect(result.transferredIn).toEqual([]);
    expect(result.transferredOut).toEqual([]);
  });
});

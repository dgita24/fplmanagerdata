import { describe, expect, it } from 'vitest';

type FixtureLike = {
  kickoff_time: string | null;
};

function buildDateHeaders(fixtures: FixtureLike[]): string[] {
  let lastDateLabel = '';
  const headers: string[] = [];

  for (const fixture of fixtures) {
    const dateLabel = fixture.kickoff_time
      ? new Date(fixture.kickoff_time).toLocaleDateString('en-GB', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : 'Date TBC';

    if (dateLabel !== lastDateLabel) {
      headers.push(dateLabel);
      lastDateLabel = dateLabel;
    }
  }

  return headers;
}

describe('Fixtures modal date headers', () => {
  it('adds one header for multiple fixtures on the same day', () => {
    const headers = buildDateHeaders([
      { kickoff_time: '2025-05-20T18:30:00Z' },
      { kickoff_time: '2025-05-20T19:15:00Z' },
    ]);

    expect(headers).toEqual(['Tuesday, 20 May 2025']);
  });

  it('adds a new header when the calendar day changes', () => {
    const headers = buildDateHeaders([
      { kickoff_time: '2025-05-20T18:30:00Z' },
      { kickoff_time: '2025-05-21T18:30:00Z' },
      { kickoff_time: '2025-05-21T20:00:00Z' },
    ]);

    expect(headers).toEqual([
      'Tuesday, 20 May 2025',
      'Wednesday, 21 May 2025',
    ]);
  });

  it('uses Date TBC when kickoff_time is missing', () => {
    const headers = buildDateHeaders([
      { kickoff_time: null },
      { kickoff_time: null },
      { kickoff_time: '2025-05-22T18:30:00Z' },
    ]);

    expect(headers).toEqual([
      'Date TBC',
      'Thursday, 22 May 2025',
    ]);
  });
});

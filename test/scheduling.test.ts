import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isTimezone,
  parseReminderTime,
  parseScheduledTime,
} from '../src/utils/scheduling';

const now = new Date('2026-01-01T00:00:00Z');
describe('guild scheduling', () => {
  it('converts local time using the selected IANA timezone', () => {
    assert.equal(
      parseScheduledTime(
        '2026-12-05 20:00',
        'America/New_York',
        now,
      )?.toISOString(),
      '2026-12-06T01:00:00.000Z',
    );
    assert.equal(
      parseScheduledTime(
        '2026-07-05 20:00',
        'America/New_York',
        now,
      )?.toISOString(),
      '2026-07-06T00:00:00.000Z',
    );
    assert.equal(
      parseScheduledTime(
        '2026-07-05 20:00',
        'Asia/Kolkata',
        now,
      )?.toISOString(),
      '2026-07-05T14:30:00.000Z',
    );
  });
  it('rejects invalid dates, past times, invalid zones, and DST gaps or overlaps', () => {
    assert.equal(isTimezone('Not/AZone'), false);
    for (const input of [
      '2026-02-30 20:00',
      '2026-12-05 25:00',
      'garbage',
      '2025-12-05 20:00',
    ])
      assert.equal(parseScheduledTime(input, 'UTC', now), null);
    assert.equal(
      parseScheduledTime('2026-03-08 02:30', 'America/New_York', now),
      null,
    );
    assert.equal(
      parseScheduledTime('2026-11-01 01:30', 'America/New_York', now),
      null,
    );
    assert.equal(
      parseScheduledTime(
        '2026-11-01T01:30:00-04:00',
        'America/New_York',
        now,
      )?.toISOString(),
      '2026-11-01T05:30:00.000Z',
    );
  });
  it('requires an entire valid duration and interprets tomorrow in the guild timezone', () => {
    assert.equal(
      parseReminderTime('2h30m', 'UTC', now)?.getTime(),
      now.getTime() + 9000000,
    );
    assert.equal(parseReminderTime('garbage 2h', 'UTC', now), null);
    assert.equal(parseReminderTime('0m', 'UTC', now), null);
    assert.equal(
      parseReminderTime(
        'tomorrow',
        'America/New_York',
        new Date('2026-01-01T02:00:00Z'),
      )?.toISOString(),
      '2026-01-01T14:00:00.000Z',
    );
  });
});

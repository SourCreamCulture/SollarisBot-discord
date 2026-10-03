import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { createJsonUtilityStore } from '../src/utils/utilityStore';
import type { Logger } from '../src/utils/logger';

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const tempDirectories: string[] = [];

const createTempStorePath = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'sollaris-utility-store-'));
  tempDirectories.push(directory);
  return join(directory, 'data', 'utility-store.json');
};

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('createJsonUtilityStore', () => {
  it('persists reminders, poll votes, and event RSVPs', async () => {
    const filePath = await createTempStorePath();
    const store = await createJsonUtilityStore(filePath, logger);
    const reminder = await store.addReminder({
      guildId: 'guild-1',
      channelId: 'channel-1',
      userId: 'user-1',
      message: 'stretch',
      remindAt: '2026-04-23T00:00:00.000Z',
    });
    const poll = await store.addPoll({
      guildId: 'guild-1',
      channelId: 'channel-1',
      question: 'Map?',
      options: ['Worlds Edge', 'Olympus'],
      createdById: 'user-1',
    });
    const event = await store.addEvent({
      guildId: 'guild-1',
      channelId: 'channel-1',
      title: 'Ranked Night',
      startsAt: '2099-04-24T00:00:00.000Z',
      createdById: 'user-1',
    });

    await store.votePoll(poll.id, 'user-2', 1);
    await store.toggleEventRsvp(event.id, 'user-2');

    const reloaded = await createJsonUtilityStore(filePath, logger);

    assert.equal(
      reloaded.getDueReminders(new Date('2026-04-23T00:01:00.000Z'))[0].id,
      reminder.id,
    );
    assert.equal(reloaded.getPoll(poll.id)?.votes['user-2'], 1);
    assert.deepEqual(reloaded.getEvent(event.id)?.attendees, ['user-2']);
  });
});

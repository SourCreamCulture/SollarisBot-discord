import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eventCommand } from '../src/commands/event';
import { remindCommand } from '../src/commands/remind';
import { settingsCommand } from '../src/commands/settings';
import {
  createJsonUtilityStore,
  type UtilityStore,
} from '../src/utils/utilityStore';
import type { CommandContext } from '../src/types/bot';
const logger = { info() {}, warn() {}, error() {}, debug() {} };
const directories: string[] = [];
const fixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'utility-commands-'));
  directories.push(directory);
  return createJsonUtilityStore(join(directory, 'store.json'), logger);
};
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
const context = (
  store: UtilityStore,
  sub: string,
  values: Record<string, string | number> = {},
  userId = 'host',
  guildId = 'g',
  manageGuild = false,
) => {
  const errors: string[] = [];
  const successes: string[] = [];
  let edits = 0;
  const ctx = {
    utilityStore: store,
    logger,
    deferReply: async () => undefined,
    replyError: async (message: string) => {
      errors.push(message);
    },
    replySuccess: async (message: string) => {
      successes.push(message);
    },
    interaction: {
      guildId,
      channelId: 'c',
      user: { id: userId },
      memberPermissions: { has: () => manageGuild },
      options: {
        getSubcommand: () => sub,
        getString: (name: string) => values[name] ?? null,
        getInteger: (name: string) => values[name] ?? null,
      },
      editReply: async () => ({ id: 'message' }),
      client: {
        channels: {
          fetch: async () => ({
            guildId: 'g',
            isTextBased: () => true,
            messages: {
              fetch: async () => ({
                edit: async () => {
                  edits++;
                },
              }),
            },
          }),
        },
      },
    },
  } as unknown as CommandContext;
  return { ctx, errors, successes, edits: () => edits };
};

describe('utility command behavior', () => {
  it('creates events with guild timezone/reminder defaults and edits/cancels the persisted message', async () => {
    const store = await fixture();
    await store.updateGuildSettings('g', {
      timezone: 'America/New_York',
      eventReminderMinutes: 30,
    });
    const created = context(store, 'create', {
      title: 'Ranked',
      starts: '2099-12-05 20:00',
      limit: 5,
    });
    await eventCommand.execute(created.ctx);
    assert.deepEqual(created.errors, []);
    const event = store.listEvents('g')[0];
    assert.equal(event.startsAt, '2099-12-06T01:00:00.000Z');
    assert.equal(event.reminderMinutes, 30);
    assert.equal(event.capacity, 5);
    assert.equal(event.messageId, 'message');
    const edit = context(store, 'edit', {
      id: event.id,
      title: 'New Ranked',
      limit: 0,
    });
    await eventCommand.execute(edit.ctx);
    assert.equal(store.getEvent(event.id)?.capacity, null);
    assert.equal(edit.edits(), 1);
    const cancel = context(store, 'cancel', { id: event.id });
    await eventCommand.execute(cancel.ctx);
    assert.equal(store.getEvent(event.id)?.cancelled, true);
    assert.equal(cancel.edits(), 1);
  });
  it('rejects edits from other members/guilds while permitting server managers', async () => {
    const store = await fixture();
    const event = await store.addEvent({
      guildId: 'g',
      channelId: 'c',
      createdById: 'host',
      title: 'Ranked',
      startsAt: '2099-12-06T01:00:00.000Z',
    });
    for (const [user, guild, manage] of [
      ['other', 'g', false],
      ['host', 'other', true],
    ] as const) {
      const denied = context(
        store,
        'cancel',
        { id: event.id },
        user,
        guild,
        manage,
      );
      await eventCommand.execute(denied.ctx);
      assert.equal(denied.errors.length, 1);
      assert.equal(store.getEvent(event.id)?.cancelled, false);
    }
    await eventCommand.execute(
      context(store, 'cancel', { id: event.id }, 'admin', 'g', true).ctx,
    );
    assert.equal(store.getEvent(event.id)?.cancelled, true);
  });
  it('allows reminder cancellation only for its owner and guild', async () => {
    const store = await fixture();
    const reminder = await store.addReminder({
      guildId: 'g',
      channelId: 'c',
      userId: 'host',
      message: 'hello',
      remindAt: '2099-12-06T01:00:00.000Z',
    });
    for (const [user, guild] of [
      ['other', 'g'],
      ['host', 'other'],
    ]) {
      const denied = context(store, 'cancel', { id: reminder.id }, user, guild);
      await remindCommand.execute(denied.ctx);
      assert.equal(denied.errors.length, 1);
      assert.ok(store.getReminder(reminder.id));
    }
    await remindCommand.execute(
      context(store, 'cancel', { id: reminder.id }).ctx,
    );
    assert.equal(store.getReminder(reminder.id), null);
  });
  it('requires Manage Server before changing guild settings', async () => {
    const store = await fixture();
    const denied = context(store, 'timezone', { zone: 'America/New_York' });
    await settingsCommand.execute(denied.ctx);
    assert.equal(denied.errors.length, 1);
    assert.equal(store.getGuildSettings('g').timezone, 'UTC');
    const allowed = context(
      store,
      'timezone',
      { zone: 'America/New_York' },
      'admin',
      'g',
      true,
    );
    await settingsCommand.execute(allowed.ctx);
    assert.deepEqual(allowed.errors, []);
    assert.equal(store.getGuildSettings('g').timezone, 'America/New_York');
  });
});

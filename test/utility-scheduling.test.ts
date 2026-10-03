import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJsonUtilityStore } from '../src/utils/utilityStore';
import {
  buildEventPayload,
  buildLfgPayload,
  UtilityInteractionManager,
} from '../src/utils/utilityInteractions';
const logger = { info() {}, warn() {}, error() {}, debug() {} };
const directories: string[] = [];
const fixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'utility-scheduling-'));
  directories.push(directory);
  const path = join(directory, 'store.json');
  return { store: await createJsonUtilityStore(path, logger), path };
};
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
const future = (minutes: number) =>
  new Date(Date.now() + minutes * 60000).toISOString();
const eventInput = () => ({
  guildId: 'g',
  channelId: 'c',
  title: 'Game Night',
  startsAt: future(10),
  createdById: 'host',
});
const reminderInput = () => ({
  guildId: 'g',
  channelId: 'c',
  userId: 'u',
  message: 'hello @everyone',
  remindAt: new Date(Date.now() - 60000).toISOString(),
});
const clientWithSend = (send: (...args: unknown[]) => Promise<unknown>) => ({
  channels: {
    fetch: async () => ({ guildId: 'g', isTextBased: () => true, send }),
  },
});

describe('persistent events and LFGs', () => {
  it('enforces capacity under concurrent RSVPs, permits leaving, and persists cancellation', async () => {
    const { store, path } = await fixture();
    const event = await store.addEvent({ ...eventInput(), capacity: 1 });
    const joined = await Promise.allSettled([
      store.toggleEventRsvp(event.id, 'a'),
      store.toggleEventRsvp(event.id, 'b'),
    ]);
    assert.equal(joined.filter((r) => r.status === 'fulfilled').length, 1);
    assert.deepEqual(store.getEvent(event.id)?.attendees, ['a']);
    await assert.rejects(store.updateEvent(event.id, { capacity: 0.5 }));
    await store.toggleEventRsvp(event.id, 'a');
    await store.toggleEventRsvp(event.id, 'b');
    await store.updateEvent(event.id, { cancelled: true });
    assert.equal(await store.toggleEventRsvp(event.id, 'a'), null);
    assert.equal(store.getDueEvents(new Date()).length, 0);
    assert.equal(
      (await createJsonUtilityStore(path, logger)).getEvent(event.id)
        ?.cancelled,
      true,
    );
    assert.equal(
      buildEventPayload(store.getEvent(event.id)!).components[0].toJSON()
        .components[0].disabled,
      true,
    );
  });
  it('resets event reminder state when rescheduling and never notifies outside the reminder window', async () => {
    const { store } = await fixture();
    const event = await store.addEvent({
      ...eventInput(),
      reminderMinutes: 15,
    });
    await store.toggleEventRsvp(event.id, 'a');
    assert.equal(store.getDueEvents(new Date()).length, 1);
    await store.markEventReminded(event.id, ['a']);
    assert.equal(store.getDueEvents(new Date()).length, 0);
    await store.updateEvent(event.id, { startsAt: future(60) });
    assert.deepEqual(store.getEvent(event.id)?.remindedUserIds, []);
    assert.equal(store.getDueEvents(new Date()).length, 0);
    assert.equal(
      store.getDueEvents(new Date(Date.now() + 50 * 60000)).length,
      1,
    );
    assert.equal(
      store.getDueEvents(new Date(Date.now() + 61 * 60000)).length,
      0,
    );
  });
  it('persists LFG joins/leaves, limits slots, protects host actions, and rejects expired posts', async () => {
    const { store, path } = await fixture();
    const lfg = await store.addLfg({
      guildId: 'g',
      channelId: 'c',
      game: 'apex',
      createdById: 'host',
      description: 'Ranked',
      capacity: 2,
      expiresAt: future(1),
    });
    await store.updateLfgParticipant(lfg.id, 'a', 'join');
    await assert.rejects(
      store.updateLfgParticipant(lfg.id, 'b', 'join'),
      /full/,
    );
    await assert.rejects(
      store.updateLfgParticipant(lfg.id, 'a', 'close'),
      /host/,
    );
    await assert.rejects(
      store.updateLfgParticipant(lfg.id, 'host', 'leave'),
      /host/,
    );
    await store.updateLfgParticipant(lfg.id, 'a', 'leave');
    await store.updateLfgParticipant(lfg.id, 'b', 'join');
    const reloaded = await createJsonUtilityStore(path, logger);
    assert.deepEqual(reloaded.getLfg(lfg.id)?.participants, ['host', 'b']);
    await reloaded.updateLfgParticipant(lfg.id, 'host', 'close');
    assert.equal(
      await reloaded.updateLfgParticipant(lfg.id, 'b', 'leave'),
      null,
    );
    assert.ok(
      buildLfgPayload(reloaded.getLfg(lfg.id)!)
        .components[0].toJSON()
        .components.every((c) => c.disabled),
    );
    const expired = await reloaded.addLfg({
      ...lfg,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    assert.equal(
      await reloaded.updateLfgParticipant(expired.id, 'b', 'join'),
      null,
    );
    assert.equal(reloaded.getExpiredLfgs(new Date()).length, 2);
  });
});

describe('scheduled delivery', () => {
  it('retains failed reminders, persists backoff across restart, and removes them after successful delivery', async () => {
    const { store, path } = await fixture();
    const reminder = await store.addReminder(reminderInput());
    const now = new Date();
    await new UtilityInteractionManager(store, logger).tick(
      clientWithSend(async () => {
        throw new Error('offline');
      }) as never,
      now,
    );
    assert.equal(store.getReminder(reminder.id)?.attempts, 1);
    assert.equal(store.getDueReminders(now).length, 0);
    const reloaded = await createJsonUtilityStore(path, logger);
    assert.ok(reloaded.getReminder(reminder.id));
    const sent: unknown[] = [];
    await new UtilityInteractionManager(reloaded, logger).tick(
      clientWithSend(async (payload) => {
        sent.push(payload);
      }) as never,
      new Date(now.getTime() + 120000),
    );
    assert.equal(sent.length, 1);
    assert.equal(reloaded.getReminder(reminder.id), null);
    assert.deepEqual(
      (sent[0] as { allowedMentions: unknown }).allowedMentions,
      { parse: [], users: ['u'] },
    );
  });
  it('sends only once when timer ticks overlap', async () => {
    const { store } = await fixture();
    await store.addReminder(reminderInput());
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let sendCount = 0;
    const manager = new UtilityInteractionManager(store, logger);
    const client = clientWithSend(async () => {
      sendCount++;
      await blocked;
    });
    const first = manager.tick(client as never);
    const second = manager.tick(client as never);
    release();
    await Promise.all([first, second]);
    assert.equal(sendCount, 1);
  });
  it('honors cancellation during a channel fetch and never sends into another guild', async () => {
    const { store } = await fixture();
    const reminder = await store.addReminder(reminderInput());
    let sends = 0;
    const manager = new UtilityInteractionManager(store, logger);
    await manager.tick({
      channels: {
        fetch: async () => {
          await store.removeReminder(reminder.id);
          return {
            guildId: 'g',
            isTextBased: () => true,
            send: async () => {
              sends++;
            },
          };
        },
      },
    } as never);
    assert.equal(sends, 0);
    const second = await store.addReminder(reminderInput());
    await manager.tick({
      channels: {
        fetch: async () => ({
          guildId: 'other',
          isTextBased: () => true,
          send: async () => {
            sends++;
          },
        }),
      },
    } as never);
    assert.equal(sends, 0);
    assert.ok(store.getReminder(second.id));
  });
  it('retries failed attendee notifications and suppresses delivered notifications after restart', async () => {
    const { store, path } = await fixture();
    const event = await store.addEvent(eventInput());
    await store.toggleEventRsvp(event.id, 'a');
    const now = new Date();
    await new UtilityInteractionManager(store, logger).tick(
      clientWithSend(async () => {
        throw new Error('offline');
      }) as never,
      now,
    );
    assert.equal(store.getDueEvents(now).length, 0);
    const reloaded = await createJsonUtilityStore(path, logger);
    let sends = 0;
    await new UtilityInteractionManager(reloaded, logger).tick(
      clientWithSend(async () => {
        sends++;
      }) as never,
      new Date(now.getTime() + 120000),
    );
    assert.equal(sends, 1);
    assert.deepEqual(reloaded.getEvent(event.id)?.remindedUserIds, ['a']);
    await new UtilityInteractionManager(
      await createJsonUtilityStore(path, logger),
      logger,
    ).tick(
      clientWithSend(async () => {
        sends++;
      }) as never,
    );
    assert.equal(sends, 1);
  });
  it('disables expired LFG controls and remembers the update', async () => {
    const { store } = await fixture();
    const lfg = await store.addLfg({
      guildId: 'g',
      channelId: 'c',
      messageId: 'm',
      game: 'valorant',
      createdById: 'host',
      description: 'Queue',
      capacity: 5,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    let edits = 0;
    const client = {
      channels: {
        fetch: async () => ({
          guildId: 'g',
          isTextBased: () => true,
          messages: {
            fetch: async () => ({
              edit: async (payload: ReturnType<typeof buildLfgPayload>) => {
                edits++;
                assert.ok(
                  payload.components[0]
                    .toJSON()
                    .components.every((c) => c.disabled),
                );
              },
            }),
          },
        }),
      },
    };
    const manager = new UtilityInteractionManager(store, logger);
    await manager.tick(client as never);
    await manager.tick(client as never);
    assert.equal(edits, 1);
    assert.equal(store.getLfg(lfg.id)?.expiryRendered, true);
  });
});

describe('utility button authorization', () => {
  const button = (
    id: string,
    guildId: string,
    channelId: string,
    userId: string,
  ) => {
    const errors: unknown[] = [];
    return {
      errors,
      interaction: {
        customId: id,
        guildId,
        channelId,
        user: { id: userId },
        message: { id: 'message' },
        isButton: () => true,
        inCachedGuild: () => true,
        deferUpdate: async () => undefined,
        editReply: async () => undefined,
        followUp: async (payload: unknown) => {
          errors.push(payload);
        },
        member: { roles: { cache: new Map() } },
        memberPermissions: { has: () => false },
      },
    };
  };
  it('rejects cross-guild and cross-channel event interactions before mutating RSVPs', async () => {
    const { store } = await fixture();
    const event = await store.addEvent(eventInput());
    const manager = new UtilityInteractionManager(store, logger);
    for (const [guild, channel] of [
      ['other', 'c'],
      ['g', 'other'],
    ]) {
      const fake = button(`event-rsvp:${event.id}`, guild, channel, 'a');
      assert.equal(await manager.handleButton(fake.interaction as never), true);
      assert.equal(fake.errors.length, 1);
    }
    assert.deepEqual(store.getEvent(event.id)?.attendees, []);
  });
  it('applies newly configured roles to old buttons and permits authorized joins', async () => {
    const { store } = await fixture();
    const lfg = await store.addLfg({
      guildId: 'g',
      channelId: 'c',
      messageId: 'message',
      game: 'apex',
      createdById: 'host',
      description: 'Ranked',
      capacity: 3,
      expiresAt: future(10),
    });
    await store.updateGuildSettings('g', { commandRoles: { lfg: 'players' } });
    const manager = new UtilityInteractionManager(store, logger);
    const denied = button(`lfg:${lfg.id}:join`, 'g', 'c', 'a');
    await manager.handleButton(denied.interaction as never);
    assert.equal(denied.errors.length, 1);
    assert.deepEqual(store.getLfg(lfg.id)?.participants, ['host']);
    const allowed = button(`lfg:${lfg.id}:join`, 'g', 'c', 'a');
    allowed.interaction.member.roles.cache.set('players', {});
    await manager.handleButton(allowed.interaction as never);
    assert.equal(allowed.errors.length, 0);
    assert.deepEqual(store.getLfg(lfg.id)?.participants, ['host', 'a']);
  });
});

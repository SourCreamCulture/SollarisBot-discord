import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJsonUtilityStore } from '../src/utils/utilityStore';
import { commandTarget, restrictionError } from '../src/utils/guildPermissions';
import { buildHelpEmbed } from '../src/utils/help';
import { commands } from '../src/commands';
const logger = { info() {}, warn() {}, error() {}, debug() {} };
const directories: string[] = [];
const path = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'guild-settings-'));
  directories.push(dir);
  return join(dir, 'store.json');
};
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
describe('guild settings and help', () => {
  it('migrates existing utility JSON with defaults and persists isolated guild settings', async () => {
    const file = await path();
    await writeFile(
      file,
      JSON.stringify({ version: 1, reminders: {}, events: {}, polls: {} }),
    );
    const store = await createJsonUtilityStore(file, logger);
    await store.updateGuildSettings('guild-a', {
      timezone: 'America/New_York',
      leaderboardChannelId: 'channel-a',
      commandChannels: { apex: 'channel-a' },
      commandRoles: { lfg: 'role-a' },
    });
    const loaded = await createJsonUtilityStore(file, logger);
    assert.equal(
      loaded.getGuildSettings('guild-a').timezone,
      'America/New_York',
    );
    assert.equal(loaded.getGuildSettings('guild-b').timezone, 'UTC');
    assert.equal(loaded.getGuildSettings('guild-b').leaderboardChannelId, null);
    const copy = loaded.getGuildSettings('guild-a');
    copy.commandChannels.apex = 'bad';
    assert.equal(
      loaded.getGuildSettings('guild-a').commandChannels.apex,
      'channel-a',
    );
    await loaded.updateGuildSettings('guild-a', {
      leaderboardChannelId: null,
      commandChannels: {},
    });
    assert.equal(
      (await createJsonUtilityStore(file, logger)).getGuildSettings('guild-a')
        .leaderboardChannelId,
      null,
    );
  });
  it('enforces channel and role bindings and leaves settings/help accessible', async () => {
    const store = await createJsonUtilityStore(await path(), logger);
    const settings = await store.updateGuildSettings('g', {
      commandChannels: { event: 'events' },
      commandRoles: { event: 'organizer' },
    });
    assert.match(
      restrictionError(settings, 'event', 'wrong', ['organizer'], false)!,
      /events/,
    );
    assert.match(
      restrictionError(settings, 'event', 'events', [], false)!,
      /organizer/,
    );
    assert.equal(
      restrictionError(settings, 'event', 'events', ['organizer'], false),
      null,
    );
    assert.equal(restrictionError(settings, 'event', 'events', [], true), null);
    assert.equal(commandTarget('settings', 'channel'), null);
    assert.equal(commandTarget('bot', 'help'), null);
    assert.equal(commandTarget('valorant', 'lfg'), 'lfg');
    assert.equal(
      restrictionError(
        store.getGuildSettings('other'),
        'event',
        'wrong',
        [],
        false,
      ),
      null,
    );
  });
  it('serializes every slash command and generates help within Discord embed limits', () => {
    assert.equal(
      new Set(commands.map((c) => c.data.name)).size,
      commands.length,
    );
    for (const command of commands) assert.ok(command.data.toJSON());
    for (const category of ['all', 'music', 'games', 'utilities', 'admin']) {
      const embed = buildHelpEmbed(commands, category).toJSON();
      assert.ok((embed.fields?.length ?? 0) <= 25);
      assert.ok(embed.fields?.every((f) => f.value.length <= 1024));
      const text = [
        embed.title,
        embed.description,
        embed.footer?.text,
        ...(embed.fields ?? []).flatMap((f) => [f.name, f.value]),
      ].join('');
      assert.ok(
        text.length <= 6000,
        `${category} has ${text.length} characters`,
      );
    }
    assert.match(
      JSON.stringify(buildHelpEmbed(commands, 'games').toJSON()),
      /apex lfg/,
    );
    assert.match(
      JSON.stringify(buildHelpEmbed(commands, 'utilities').toJSON()),
      /event cancel/,
    );
  });
});

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it } from 'node:test';

import { createJsonValorantLeaderboardStateStore } from '../src/valorant/leaderboardStore';
import type { Logger } from '../src/utils/logger';

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

describe('createJsonValorantLeaderboardStateStore', () => {
  it('persists leaderboard message refs and reloads defensive copies', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'sollarisbot-valorant-leaderboard-'),
    );

    try {
      const filePath = join(directory, 'leaderboard.json');
      const store = await createJsonValorantLeaderboardStateStore(
        filePath,
        logger,
      );

      await store.setState({
        channelId: 'channel-1',
        messageId: 'message-1',
        updatedAt: '2026-06-04T00:00:00.000Z',
        snapshots: {
          'user-1': {
            discordUserId: 'user-1',
            name: 'Player',
            tag: 'NA1',
            region: 'na',
            platform: 'pc',
            rank: 'Gold 2',
            rr: 66,
            elo: 1000,
            leaderboardPosition: 1,
          },
        },
      });
      const loaded = store.getState('channel-1');

      assert.equal(loaded?.snapshots['user-1']?.rr, 66);

      if (loaded) {
        loaded.snapshots['user-1'].rr = 1;
      }

      const reloaded = await createJsonValorantLeaderboardStateStore(
        filePath,
        logger,
      );

      assert.equal(reloaded.getState('channel-1')?.messageId, 'message-1');
      assert.equal(reloaded.getState('channel-1')?.snapshots['user-1']?.rr, 66);
      assert.equal(await reloaded.deleteState('channel-1'), true);
      assert.equal(reloaded.getState('channel-1'), null);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('loads older state files without snapshot history', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'sollarisbot-valorant-leaderboard-'),
    );

    try {
      const filePath = join(directory, 'leaderboard.json');
      await writeFile(
        filePath,
        `${JSON.stringify({
          version: 1,
          channels: {
            'channel-1': {
              channelId: 'channel-1',
              messageId: 'message-1',
              updatedAt: '2026-06-04T00:00:00.000Z',
            },
          },
        })}\n`,
        'utf8',
      );

      const store = await createJsonValorantLeaderboardStateStore(
        filePath,
        logger,
      );

      assert.deepEqual(store.getState('channel-1')?.snapshots, {});
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

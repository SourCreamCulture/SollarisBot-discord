import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
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
      });

      const reloaded = await createJsonValorantLeaderboardStateStore(
        filePath,
        logger,
      );

      assert.equal(reloaded.getState('channel-1')?.messageId, 'message-1');
      assert.equal(await reloaded.deleteState('channel-1'), true);
      assert.equal(reloaded.getState('channel-1'), null);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

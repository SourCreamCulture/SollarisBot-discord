import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import type { Track } from 'discord-player';

import { createJsonMusicStatsService } from '../src/music/stats';
import type { Logger } from '../src/utils/logger';

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const tempDirectories: string[] = [];

const createTempStorePath = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'sollaris-music-stats-'));
  tempDirectories.push(directory);
  return join(directory, 'data', 'music-stats.json');
};

const createTrack = (suffix: string, userId = 'user-1'): Track =>
  ({
    title: `Track ${suffix}`,
    url: `https://example.com/track-${suffix}`,
    duration: '3:30',
    author: 'Test Artist',
    requestedBy: { id: userId },
  }) as Track;

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('createJsonMusicStatsService', () => {
  it('records track, artist, requester, and user listening stats', async () => {
    const filePath = await createTempStorePath();
    const stats = await createJsonMusicStatsService(filePath, logger);

    await stats.recordTrackStart('guild-1', createTrack('a'));
    await stats.recordTrackStart('guild-1', createTrack('a'));
    await stats.recordTrackStart('guild-1', createTrack('b', 'user-2'));

    const server = stats.getServerStats('guild-1');
    const user = stats.getUserStats('guild-1', 'user-1');

    assert.equal(server.trackCount, 3);
    assert.equal(server.topTrack?.title, 'Track a');
    assert.equal(server.topArtist?.name, 'Test Artist');
    assert.equal(server.requesterCount, 2);
    assert.equal(user.trackCount, 2);
    assert.equal(user.favoriteArtist?.plays, 2);
    assert.ok(user.currentStreakDays >= 1);
  });
});

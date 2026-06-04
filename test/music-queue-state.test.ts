import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import {
  createJsonQueueStateService,
  type PersistedQueueState,
} from '../src/music/queueState';
import type { Logger } from '../src/utils/logger';

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const tempDirectories: string[] = [];

const createTempStorePath = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'sollaris-queue-state-'));
  tempDirectories.push(directory);
  return join(directory, 'data', 'music-queue-state.json');
};

const createState = (
  overrides: Partial<PersistedQueueState> = {},
): PersistedQueueState => ({
  guildId: 'guild-1',
  textChannelId: 'text-1',
  voiceChannelId: 'voice-1',
  currentTrack: {
    title: 'Current Track',
    url: 'https://example.com/current',
    duration: '3:00',
    author: 'Test Artist',
    addedById: 'user-1',
    addedAt: '2026-06-03T00:00:00.000Z',
  },
  upcomingTracks: [
    {
      title: 'Next Track',
      url: 'https://example.com/next',
      duration: '4:00',
      author: 'Test Artist',
      addedById: 'user-2',
      addedAt: '2026-06-03T00:01:00.000Z',
    },
  ],
  volume: 65,
  repeatMode: 0,
  updatedAt: '2026-06-03T00:02:00.000Z',
  ...overrides,
});

const freshQueueStateOptions = {
  now: () => new Date('2026-06-03T00:03:00.000Z'),
};

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('createJsonQueueStateService', () => {
  it('persists queue snapshots and reloads defensive copies', async () => {
    const filePath = await createTempStorePath();
    const state = createState();
    const service = await createJsonQueueStateService(
      filePath,
      logger,
      freshQueueStateOptions,
    );

    await service.save(state);

    const fromMemory = service.get('guild-1');
    assert.deepEqual(fromMemory, state);

    if (!fromMemory) {
      throw new Error('Expected queue state to exist.');
    }

    fromMemory.upcomingTracks[0].title = 'Mutated Outside Store';
    assert.equal(
      service.get('guild-1')?.upcomingTracks[0]?.title,
      'Next Track',
    );

    const reloaded = await createJsonQueueStateService(
      filePath,
      logger,
      freshQueueStateOptions,
    );
    assert.deepEqual(reloaded.get('guild-1'), state);

    const payload = JSON.parse(await readFile(filePath, 'utf8')) as {
      version: number;
      guilds: Record<string, PersistedQueueState>;
    };

    assert.equal(payload.version, 1);
    assert.deepEqual(payload.guilds['guild-1'], state);
  });

  it('clears queue snapshots from memory and disk', async () => {
    const filePath = await createTempStorePath();
    const service = await createJsonQueueStateService(
      filePath,
      logger,
      freshQueueStateOptions,
    );

    await service.save(createState());
    await service.clear('guild-1');

    assert.equal(service.get('guild-1'), null);

    const payload = JSON.parse(await readFile(filePath, 'utf8')) as {
      guilds: Record<string, PersistedQueueState>;
    };

    assert.deepEqual(payload.guilds, {});
  });

  it('persists panel message references and preserves them across snapshot saves', async () => {
    const filePath = await createTempStorePath();
    const service = await createJsonQueueStateService(
      filePath,
      logger,
      freshQueueStateOptions,
    );
    const state = createState({
      panelMessage: {
        channelId: 'panel-channel-1',
        messageId: 'panel-message-1',
      },
    });

    await service.save(state);

    const updatedSnapshot = createState({
      currentTrack: null,
      upcomingTracks: [],
      updatedAt: '2026-06-03T00:05:00.000Z',
    });

    await service.save(updatedSnapshot);

    assert.deepEqual(service.get('guild-1')?.panelMessage, {
      channelId: 'panel-channel-1',
      messageId: 'panel-message-1',
    });

    const reloaded = await createJsonQueueStateService(
      filePath,
      logger,
      freshQueueStateOptions,
    );

    assert.deepEqual(reloaded.get('guild-1')?.panelMessage, {
      channelId: 'panel-channel-1',
      messageId: 'panel-message-1',
    });
  });

  it('prunes stale queue snapshots during initialize', async () => {
    const filePath = await createTempStorePath();
    const staleState = createState({
      guildId: 'guild-stale',
      updatedAt: '2026-06-02T11:59:59.000Z',
    });
    const freshState = createState({
      guildId: 'guild-fresh',
      updatedAt: '2026-06-03T12:00:00.000Z',
    });
    const service = await createJsonQueueStateService(filePath, logger);

    await service.save(staleState);
    await service.save(freshState);

    const reloaded = await createJsonQueueStateService(filePath, logger, {
      restoreMaxAgeMs: 24 * 60 * 60 * 1000,
      now: () => new Date('2026-06-04T12:00:00.000Z'),
    });

    assert.equal(reloaded.get('guild-stale'), null);
    assert.deepEqual(reloaded.get('guild-fresh'), freshState);

    const payload = JSON.parse(await readFile(filePath, 'utf8')) as {
      guilds: Record<string, PersistedQueueState>;
    };

    assert.deepEqual(Object.keys(payload.guilds), ['guild-fresh']);
  });
});

import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { createJsonApexLinkStore } from '../src/apex/store';
import type { ApexLinkedAccount } from '../src/apex/types';
import type { Logger } from '../src/utils/logger';

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const tempDirectories: string[] = [];

const createTempStorePath = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'sollaris-apex-store-'));
  tempDirectories.push(directory);
  return join(directory, 'data', 'apex-links.json');
};

const createSampleLink = (): ApexLinkedAccount => ({
  discordUserId: '1234567890',
  appPlatform: 'xbox',
  providerPlatform: 'xbl',
  username: 'PilotPlayer',
  displayName: 'Pilot Player',
  linkedAt: '2026-04-10T00:00:00.000Z',
  updatedAt: '2026-04-10T00:00:00.000Z',
});

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('createJsonApexLinkStore', () => {
  it('bootstraps a missing file with an empty payload', async () => {
    const filePath = await createTempStorePath();
    const store = await createJsonApexLinkStore(filePath, logger);

    assert.equal(store.getLink('missing-user'), null);

    const payload = JSON.parse(await readFile(filePath, 'utf8')) as {
      version: number;
      links: Record<string, ApexLinkedAccount>;
    };

    assert.equal(payload.version, 1);
    assert.deepEqual(payload.links, {});
  });

  it('persists links with atomic replacement and round-trips them', async () => {
    const filePath = await createTempStorePath();
    const store = await createJsonApexLinkStore(filePath, logger);
    const link = createSampleLink();

    await store.setLink(link);

    const payload = JSON.parse(await readFile(filePath, 'utf8')) as {
      version: number;
      links: Record<string, ApexLinkedAccount>;
    };

    assert.deepEqual(payload.links[link.discordUserId], link);

    const reloadedStore = await createJsonApexLinkStore(filePath, logger);
    assert.deepEqual(reloadedStore.getLink(link.discordUserId), link);

    const files = await readdir(join(filePath, '..'));
    assert.deepEqual(files, ['apex-links.json']);

    const removed = await reloadedStore.deleteLink(link.discordUserId);
    assert.equal(removed, true);

    const afterDelete = JSON.parse(await readFile(filePath, 'utf8')) as {
      version: number;
      links: Record<string, ApexLinkedAccount>;
    };

    assert.deepEqual(afterDelete.links, {});
  });
});

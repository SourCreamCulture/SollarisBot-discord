import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { createMozambiqueApexApiClient } from '../src/apex/mozambiqueClient';
import { ApexError } from '../src/apex/types';
import type { Logger } from '../src/utils/logger';

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const createResponse = (status: number, payload: unknown): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });

describe('createMozambiqueApexApiClient', () => {
  it('maps bridge stats into the shared Apex profile shape', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () =>
      createResponse(200, {
        global: {
          name: 'Pilot Player',
          uid: '1001',
          avatar: 'https://example.com/avatar.png',
          platform: 'PC',
          level: 321,
        },
        rank: {
          rankScore: 15000,
          rankName: 'Diamond',
          rankDiv: 2,
        },
        total: {
          kills: {
            name: 'Kills',
            value: 4200,
          },
          damage: {
            name: 'Damage',
            value: 1111111,
          },
        },
        legends: {
          selected: {
            LegendName: 'Wraith',
          },
          all: {
            Wraith: {
              ImgAssets: {
                icon: 'https://example.com/wraith-icon.png',
                banner: 'https://example.com/wraith-banner.png',
              },
              data: [
                {
                  name: 'Kills',
                  value: 2100,
                },
              ],
            },
          },
        },
      }),
    );

    const client = createMozambiqueApexApiClient('fake-key', logger);
    const profile = await client.getProfile({
      appPlatform: 'pc',
      username: 'PilotPlayer',
    });

    assert.equal(profile.providerName, 'Apex Legends Status');
    assert.equal(profile.platformInfo.platformUserHandle, 'Pilot Player');
    assert.equal(profile.platformInfo.platformUserIdentifier, '1001');
    assert.equal(profile.metadata.activeLegendName, 'Wraith');
    assert.equal(profile.segments[0]?.stats?.level?.value, 321);
    assert.equal(profile.segments[0]?.stats?.rankScore?.metadata?.rankName, 'Diamond');
    assert.equal(profile.segments[1]?.metadata?.name, 'Wraith');
    assert.equal(profile.segments[1]?.stats?.kills?.value, 2100);

    const request = fetchMock.mock.calls[0]?.arguments[0];

    assert.equal(typeof request, 'string');
    assert.match(String(request), /\/bridge\?/);
    assert.match(String(request), /auth=fake-key/);
    assert.match(String(request), /platform=PC/);

    fetchMock.mock.restore();
  });

  it('turns provider auth failures into friendly config errors', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () =>
      createResponse(403, {
        Error: '403',
        Message: 'Unauthorized / Unknown API key',
      }),
    );

    const client = createMozambiqueApexApiClient('bad-key', logger);

    await assert.rejects(
      () =>
        client.getProfile({
          appPlatform: 'pc',
          username: 'PilotPlayer',
        }),
      (error: unknown) =>
        error instanceof ApexError &&
        error.code === 'config' &&
        error.message.includes('MOZAMBIQUE_API_KEY'),
    );

    fetchMock.mock.restore();
  });

  it('can request stats by UID instead of player name', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () =>
      createResponse(200, {
        global: {
          name: 'Pilot Player',
          uid: '1001',
          platform: 'PC',
          level: 321,
        },
        rank: {},
        total: {},
        legends: {
          selected: {
            LegendName: 'Wraith',
          },
          all: {},
        },
      }),
    );

    const client = createMozambiqueApexApiClient('fake-key', logger);
    await client.getProfile({
      appPlatform: 'pc',
      uid: '1001',
    });

    const request = fetchMock.mock.calls[0]?.arguments[0];

    assert.match(String(request), /uid=1001/);
    assert.doesNotMatch(String(request), /player=/);

    fetchMock.mock.restore();
  });

  it('maps console platform choices to Mozambique platform slugs', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () =>
      createResponse(200, {
        global: {
          name: 'Console Player',
          uid: 'console-uid',
          platform: 'X1',
          level: 10,
        },
        rank: {},
        total: {},
        legends: {
          selected: {
            LegendName: 'Bangalore',
          },
          all: {},
        },
      }),
    );

    const client = createMozambiqueApexApiClient('fake-key', logger);
    await client.getProfile({
      appPlatform: 'xbox',
      username: 'ConsolePlayer',
    });

    let request = fetchMock.mock.calls.at(-1)?.arguments[0];
    assert.match(String(request), /platform=X1/);

    await client.getProfile({
      appPlatform: 'playstation',
      username: 'ConsolePlayer',
    });

    request = fetchMock.mock.calls.at(-1)?.arguments[0];
    assert.match(String(request), /platform=PS4/);

    fetchMock.mock.restore();
  });

  it('maps BR seasonal stat names and nested rank data', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () =>
      createResponse(200, {
        global: {
          name: 'Bigdog3203',
          uid: '4047905868270790838',
          platform: 'PS4',
          level: 107,
          rank: {
            rankScore: 3250,
            rankName: 'Silver',
            rankDiv: 4,
          },
          arena: {
            rankScore: 388,
            rankName: 'Bronze',
            rankDiv: 4,
          },
        },
        rank: {},
        total: {
          damage: {
            name: 'BR Damage',
            value: 34728,
          },
          wins_season_6: {
            name: 'BR Season 6 Wins',
            value: 4,
          },
          kills_season_6: {
            name: 'BR Season 6 Kills',
            value: 38,
          },
        },
        legends: {
          selected: {
            LegendName: 'Bloodhound',
          },
          all: {
            Bloodhound: {
              ImgAssets: {},
              data: [
                {
                  name: 'BR Damage',
                  key: 'damage',
                  value: 34728,
                  rank: {
                    rankPos: 2821000,
                    topPercent: 83.43,
                  },
                },
              ],
            },
          },
        },
      }),
    );

    const client = createMozambiqueApexApiClient('fake-key', logger);
    const profile = await client.getProfile({
      appPlatform: 'playstation',
      username: 'Bigdog3203',
    });

    const overview = profile.segments[0]?.stats;
    const bloodhound = profile.segments[1]?.stats;

    assert.equal(overview?.rankScore?.value, 3250);
    assert.equal(overview?.rankScore?.metadata?.rankName, 'Silver');
    assert.equal(overview?.killsSeason6?.displayName, 'BR Season 6 Kills');
    assert.equal(overview?.winsSeason6?.value, 4);
    assert.equal(bloodhound?.damage?.rank, 2821000);
    assert.equal(bloodhound?.damage?.percentile, 83.43);

    fetchMock.mock.restore();
  });
});

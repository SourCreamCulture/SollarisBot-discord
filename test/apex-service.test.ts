import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createApexService } from '../src/apex/service';
import {
  ApexError,
  type ApexApiClient,
  type ApexLinkedAccount,
  type ApexLinkStore,
  type ApexLookupInput,
  type ApexProfile,
} from '../src/apex/types';

class InMemoryLinkStore implements ApexLinkStore {
  private readonly links = new Map<string, ApexLinkedAccount>();

  constructor(initialLinks: ApexLinkedAccount[] = []) {
    for (const link of initialLinks) {
      this.links.set(link.discordUserId, { ...link });
    }
  }

  getLink(discordUserId: string): ApexLinkedAccount | null {
    const link = this.links.get(discordUserId);
    return link ? { ...link } : null;
  }

  async setLink(link: ApexLinkedAccount): Promise<void> {
    this.links.set(link.discordUserId, { ...link });
  }

  async deleteLink(discordUserId: string): Promise<boolean> {
    return this.links.delete(discordUserId);
  }
}

class FakeApexClient implements ApexApiClient {
  public readonly requests: ApexLookupInput[] = [];

  constructor(private readonly profile: ApexProfile) {}

  async getProfile(input: ApexLookupInput): Promise<ApexProfile> {
    this.requests.push({ ...input });
    return this.profile;
  }
}

const createProfile = (): ApexProfile => ({
  platformInfo: {
    platformSlug: 'origin',
    platformUserHandle: 'Pilot Player',
    platformUserIdentifier: 'PilotPlayer',
    avatarUrl: 'https://example.com/avatar.png',
  },
  metadata: {
    activeLegendName: 'Wraith',
  },
  segments: [
    {
      type: 'overview',
      stats: {
        level: {
          displayName: 'Level',
          displayValue: '125',
          value: 125,
        },
        kills: {
          displayName: 'Kills',
          displayValue: '4,200',
          value: 4200,
        },
        damage: {
          displayName: 'Damage',
          displayValue: '1,111,111',
          value: 1111111,
        },
        matchesPlayed: {
          displayName: 'Matches Played',
          displayValue: '999',
          value: 999,
        },
        wins: {
          displayName: 'Wins',
          displayValue: '123',
          value: 123,
        },
        killsPerMatch: {
          displayName: 'Kills Per Match',
          displayValue: '4.2',
          value: 4.2,
        },
        damagePerMatch: {
          displayName: 'Damage Per Match',
          displayValue: '512.3',
          value: 512.3,
        },
        rankScore: {
          displayName: 'Rank Score',
          displayValue: '15,000 RP',
          value: 15000,
          rank: 1234,
          percentile: 96.4,
          metadata: {
            rankName: 'Diamond II',
          },
        },
        lifetimePeakRankScore: {
          displayName: 'Lifetime Peak Rank Score',
          displayValue: '16,500 RP',
          value: 16500,
          metadata: {
            rankName: 'Master',
          },
        },
      },
    },
    {
      type: 'legend',
      metadata: {
        name: 'Wraith',
        portraitImageUrl: 'https://example.com/wraith.png',
        legendColor: '#9B8651',
      },
      stats: {
        kills: {
          displayName: 'Kills',
          displayValue: '2,100',
          value: 2100,
        },
        damage: {
          displayName: 'Damage',
          displayValue: '700,000',
          value: 700000,
        },
        wins: {
          displayName: 'Wins',
          displayValue: '80',
          value: 80,
        },
      },
    },
    {
      type: 'legend',
      metadata: {
        name: 'Pathfinder',
        portraitImageUrl: 'https://example.com/pathfinder.png',
        legendColor: '#00AEEF',
      },
      stats: {
        kills: {
          displayName: 'Kills',
          displayValue: '900',
          value: 900,
        },
      },
    },
  ],
});

const createLink = (
  discordUserId: string,
  username: string,
): ApexLinkedAccount => ({
  discordUserId,
  appPlatform: 'pc',
  providerPlatform: 'origin',
  username,
  displayName: username,
  linkedAt: '2026-04-10T00:00:00.000Z',
  updatedAt: '2026-04-10T00:00:00.000Z',
});

describe('createApexService', () => {
  it('uses member links before manual values or self links for legend lookups', async () => {
    const client = new FakeApexClient(createProfile());
    const store = new InMemoryLinkStore([
      createLink('self-user', 'SelfName'),
      createLink('member-user', 'MemberName'),
    ]);
    const service = createApexService({ client, store });

    const result = await service.getLegendForRequest({
      requesterId: 'self-user',
      memberId: 'member-user',
      appPlatform: 'pc',
      username: 'ManualName',
      legend: 'Wraith',
    });

    assert.equal(client.requests.at(-1)?.username, 'MemberName');
    assert.equal(result.target.source, 'member');
    assert.equal(result.legendName, 'Wraith');
  });

  it('uses manual values when there is no member target', async () => {
    const client = new FakeApexClient(createProfile());
    const service = createApexService({
      client,
      store: new InMemoryLinkStore([createLink('self-user', 'SelfName')]),
    });

    const result = await service.getLegendForRequest({
      requesterId: 'self-user',
      appPlatform: 'pc',
      username: 'ManualName',
      legend: 'Pathfinder',
    });

    assert.equal(client.requests.at(-1)?.username, 'ManualName');
    assert.equal(result.target.source, 'manual');
    assert.match(result.title, /Pathfinder Stats/);
  });

  it('falls back to the requester link when no member or manual target is provided', async () => {
    const client = new FakeApexClient(createProfile());
    const service = createApexService({
      client,
      store: new InMemoryLinkStore([createLink('self-user', 'SelfName')]),
    });

    const result = await service.getLegendForRequest({
      requesterId: 'self-user',
      legend: 'Wraith',
    });

    assert.equal(client.requests.at(-1)?.username, 'SelfName');
    assert.equal(result.target.source, 'self');
  });

  it('rejects partial manual legend lookup input', async () => {
    const client = new FakeApexClient(createProfile());
    const service = createApexService({
      client,
      store: new InMemoryLinkStore([createLink('self-user', 'SelfName')]),
    });

    await assert.rejects(
      () =>
        service.getLegendForRequest({
          requesterId: 'self-user',
          appPlatform: 'pc',
          legend: 'Wraith',
        }),
      (error: unknown) =>
        error instanceof ApexError &&
        error.code === 'invalid_target' &&
        error.message.includes(
          'provide `platform` with either `username` or `uid`',
        ),
    );
  });

  it('supports manual UID lookups when username search is unreliable', async () => {
    const client = new FakeApexClient(createProfile());
    const service = createApexService({
      client,
      store: new InMemoryLinkStore(),
    });

    const result = await service.getOverviewForLookup({
      appPlatform: 'pc',
      uid: '1001',
    });

    assert.equal(client.requests.at(-1)?.uid, '1001');
    assert.equal(client.requests.at(-1)?.username, undefined);
    assert.match(result.title, /Apex Stats: Pilot Player/);
  });

  it('maps overview stats into a Discord-friendly summary card', async () => {
    const client = new FakeApexClient(createProfile());
    const service = createApexService({
      client,
      store: new InMemoryLinkStore(),
    });

    const result = await service.getOverviewForLookup({
      appPlatform: 'pc',
      username: 'PilotPlayer',
    });

    assert.match(result.title, /Apex Stats: Pilot Player/);
    assert.equal(result.target.displayName, 'Pilot Player');
    assert.equal(result.fields[1]?.name, 'Reliable Stats');
    assert.match(result.fields[1]?.value ?? '', /Level: \*\*125\*\*/);
    assert.match(result.fields[1]?.value ?? '', /Diamond II/);
    assert.equal(result.fields[2]?.name, 'Other Public Trackers');
    assert.match(result.fields[2]?.value ?? '', /Kills: \*\*4,200\*\*/);
    assert.match(result.fields[3]?.value ?? '', /Peak Rank: \*\*Master/);
  });

  it('hides stale seasonal kills and wins when generic totals are not available', async () => {
    const profile = createProfile();
    const overview = profile.segments[0];

    if (!overview?.stats) {
      throw new Error('Fixture is missing overview stats.');
    }

    delete overview.stats.kills;
    delete overview.stats.wins;
    overview.stats.killsSeason6 = {
      displayName: 'BR Season 6 Kills',
      displayValue: '38',
      value: 38,
    };
    overview.stats.winsSeason6 = {
      displayName: 'BR Season 6 Wins',
      displayValue: '4',
      value: 4,
    };

    const client = new FakeApexClient(profile);
    const service = createApexService({
      client,
      store: new InMemoryLinkStore(),
    });

    const result = await service.getOverviewForLookup({
      appPlatform: 'playstation',
      username: 'Bigdog3203',
    });

    const flattened = result.fields.map((field) => field.value).join('\n');

    assert.doesNotMatch(flattened, /Kills: \*\*38\*\*/);
    assert.doesNotMatch(flattened, /BR Season 6 Kills/);
    assert.doesNotMatch(flattened, /Wins: \*\*4\*\*/);
    assert.doesNotMatch(flattened, /BR Season 6 Wins/);
    assert.match(
      result.fields.at(-1)?.value ?? '',
      /reliable account snapshot/i,
    );
  });

  it('shows current-season trackers when generic totals are not available', async () => {
    const profile = createProfile();
    const overview = profile.segments[0];

    if (!overview?.stats) {
      throw new Error('Fixture is missing overview stats.');
    }

    delete overview.stats.kills;
    delete overview.stats.wins;
    overview.stats.killsSeason28 = {
      displayName: 'BR Season 28 Kills',
      displayValue: '12',
      value: 12,
    };
    overview.stats.winsSeason28 = {
      displayName: 'BR Season 28 Wins',
      displayValue: '2',
      value: 2,
    };

    const client = new FakeApexClient(profile);
    const service = createApexService({
      client,
      store: new InMemoryLinkStore(),
    });

    const result = await service.getOverviewForLookup({
      appPlatform: 'playstation',
      username: 'Bigdog3203',
    });

    assert.equal(result.fields[2]?.name, 'Current Season 28');
    assert.match(result.fields[2]?.value ?? '', /Kills: \*\*12\*\*/);
    assert.match(result.fields[2]?.value ?? '', /BR Season 28 Kills/);
    assert.match(result.fields[2]?.value ?? '', /Wins: \*\*2\*\*/);
    assert.match(result.fields[2]?.value ?? '', /BR Season 28 Wins/);
  });

  it('maps legend stats into a Discord-friendly card', async () => {
    const client = new FakeApexClient(createProfile());
    const service = createApexService({
      client,
      store: new InMemoryLinkStore(),
    });

    const result = await service.getLegendForRequest({
      requesterId: 'nobody',
      appPlatform: 'pc',
      username: 'PilotPlayer',
      legend: 'Wraith',
    });

    assert.equal(result.legendName, 'Wraith');
    assert.match(result.fields[1]?.value ?? '', /Kills: \*\*2,100\*\*/);
    assert.match(result.fields[1]?.value ?? '', /Damage: \*\*700,000\*\*/);
  });
});

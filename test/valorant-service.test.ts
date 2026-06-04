import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createValorantService } from '../src/valorant/service';
import {
  ValorantError,
  type ValorantAccount,
  type ValorantAgent,
  type ValorantHenrikClient,
  type ValorantLinkStore,
  type ValorantLinkedAccount,
  type ValorantMatchDetails,
  type ValorantMap,
  type ValorantMatchSummary,
  type ValorantMmr,
  type ValorantPlatform,
  type ValorantRegion,
  type ValorantStaticClient,
} from '../src/valorant/types';

class InMemoryValorantLinkStore implements ValorantLinkStore {
  private readonly links = new Map<string, ValorantLinkedAccount>();

  constructor(initialLinks: ValorantLinkedAccount[] = []) {
    for (const link of initialLinks) {
      this.links.set(link.discordUserId, { ...link });
    }
  }

  getLink(discordUserId: string): ValorantLinkedAccount | null {
    const link = this.links.get(discordUserId);
    return link ? { ...link } : null;
  }

  getAllLinks(): ValorantLinkedAccount[] {
    return [...this.links.values()].map((link) => ({ ...link }));
  }

  async setLink(link: ValorantLinkedAccount): Promise<void> {
    this.links.set(link.discordUserId, { ...link });
  }

  async deleteLink(discordUserId: string): Promise<boolean> {
    return this.links.delete(discordUserId);
  }
}

class FakeValorantStaticClient implements ValorantStaticClient {
  async getAgents(): Promise<ValorantAgent[]> {
    return [
      {
        uuid: 'jett',
        displayName: 'Jett',
        role: { displayName: 'Duelist' },
        abilities: [],
      },
      {
        uuid: 'sova',
        displayName: 'Sova',
        role: { displayName: 'Initiator' },
        abilities: [],
      },
      {
        uuid: 'omen',
        displayName: 'Omen',
        role: { displayName: 'Controller' },
        abilities: [],
      },
      {
        uuid: 'killjoy',
        displayName: 'Killjoy',
        role: { displayName: 'Sentinel' },
        abilities: [],
      },
      {
        uuid: 'raze',
        displayName: 'Raze',
        role: { displayName: 'Duelist' },
        abilities: [],
      },
    ];
  }

  async getMaps(): Promise<ValorantMap[]> {
    return [
      {
        uuid: 'ascent',
        displayName: 'Ascent',
        callouts: [{ regionName: 'A Main', superRegionName: 'A' }],
        calloutCount: 18,
      },
    ];
  }

  async getWeapons() {
    return [
      {
        uuid: 'vandal',
        displayName: 'Vandal',
        damageRanges: [],
      },
    ];
  }
}

class FakeValorantHenrikClient implements ValorantHenrikClient {
  public readonly mmrRequests: Array<{
    region: ValorantRegion;
    platform: ValorantPlatform;
    name: string;
    tag: string;
  }> = [];

  async getAccount(input: {
    name: string;
    tag: string;
  }): Promise<ValorantAccount> {
    return {
      puuid: `${input.name}-${input.tag}-puuid`,
      accountLevel: 123,
      name: input.name,
      tag: input.tag,
      cardUrl: 'https://example.com/card.png',
    };
  }

  async getMmr(input: {
    region: ValorantRegion;
    platform: ValorantPlatform;
    name: string;
    tag: string;
  }): Promise<ValorantMmr> {
    this.mmrRequests.push({ ...input });

    return {
      accountName: input.name,
      accountTag: input.tag,
      currentTier: 'Gold 2',
      rr: 66,
      lastChange: 18,
      elo: 1000,
      peakTier: 'Platinum 1',
      peakSeason: 'e9a1',
      seasonalWins: 10,
      seasonalGames: 20,
    };
  }

  async getMatches(input?: {
    name?: string;
    tag?: string;
  }): Promise<ValorantMatchSummary[]> {
    return [
      {
        map: 'Ascent',
        mode: 'Competitive',
        result: 'Win',
        character: input?.name === 'Entry' ? 'Jett' : 'Sova',
        kills: 18,
        deaths: 12,
        assists: 6,
        headshots: 12,
        bodyshots: 40,
        legshots: 4,
        startedAt: 1_777_777_777,
      },
      {
        map: 'Bind',
        mode: 'Competitive',
        result: 'Loss',
        character: 'Omen',
        kills: 12,
        deaths: 15,
        assists: 8,
        headshots: 8,
        bodyshots: 44,
        legshots: 2,
        startedAt: 1_777_777_000,
      },
    ];
  }

  async getMatch(): Promise<ValorantMatchDetails> {
    return {
      matchId: 'match-1',
      map: 'Ascent',
      mode: 'Competitive',
      roundsPlayed: 24,
      redRounds: 13,
      blueRounds: 11,
      winningTeam: 'Red',
      players: [
        {
          name: 'Top',
          tag: 'NA1',
          team: 'Red',
          character: 'Sova',
          tier: 'Gold 2',
          kills: 24,
          deaths: 12,
          assists: 6,
          score: 7000,
        },
      ],
    };
  }
}

const createLink = (
  discordUserId: string,
  name: string,
): ValorantLinkedAccount => ({
  discordUserId,
  name,
  tag: 'NA1',
  region: 'na',
  platform: 'pc',
  linkedAt: '2026-04-10T00:00:00.000Z',
  updatedAt: '2026-04-10T00:00:00.000Z',
});

describe('createValorantService', () => {
  it('finds static Valorant content by partial name', async () => {
    const service = createValorantService({
      staticClient: new FakeValorantStaticClient(),
      henrikClient: new FakeValorantHenrikClient(),
      store: new InMemoryValorantLinkStore(),
    });

    assert.equal((await service.findAgent('jet')).displayName, 'Jett');
    assert.equal((await service.findMap('asc')).displayName, 'Ascent');
    assert.equal((await service.findWeapon('vand')).displayName, 'Vandal');
  });

  it('links accounts after resolving them through HenrikDev', async () => {
    const store = new InMemoryValorantLinkStore();
    const service = createValorantService({
      staticClient: new FakeValorantStaticClient(),
      henrikClient: new FakeValorantHenrikClient(),
      store,
    });

    const link = await service.linkAccount({
      discordUserId: 'self-user',
      name: 'Player',
      tag: 'NA1',
      region: 'na',
      platform: 'pc',
    });

    assert.equal(link.puuid, 'Player-NA1-puuid');
    assert.equal(store.getLink('self-user')?.name, 'Player');
  });

  it('uses linked member targets before requester links', async () => {
    const henrikClient = new FakeValorantHenrikClient();
    const service = createValorantService({
      staticClient: new FakeValorantStaticClient(),
      henrikClient,
      store: new InMemoryValorantLinkStore([
        createLink('self-user', 'SelfName'),
        createLink('member-user', 'MemberName'),
      ]),
    });

    const card = await service.getRankCard({
      requesterId: 'self-user',
      memberId: 'member-user',
    });

    assert.match(card.title, /MemberName/);
    assert.equal(henrikClient.mmrRequests.at(-1)?.name, 'MemberName');
  });

  it('supports manual rank lookups and defaults to PC platform', async () => {
    const henrikClient = new FakeValorantHenrikClient();
    const service = createValorantService({
      staticClient: new FakeValorantStaticClient(),
      henrikClient,
      store: new InMemoryValorantLinkStore([createLink('self-user', 'Self')]),
    });

    await service.getRankCard({
      requesterId: 'self-user',
      name: 'ManualName',
      tag: 'EUW',
      region: 'eu',
    });

    const request = henrikClient.mmrRequests.at(-1);

    assert.equal(request?.region, 'eu');
    assert.equal(request?.platform, 'pc');
    assert.equal(request?.name, 'ManualName');
    assert.equal(request?.tag, 'EUW');
    assert.deepEqual(
      {
        region: request?.region,
        platform: request?.platform,
        name: request?.name,
        tag: request?.tag,
      },
      {
        region: 'eu',
        platform: 'pc',
        name: 'ManualName',
        tag: 'EUW',
      },
    );
  });

  it('rejects incomplete manual targets', async () => {
    const service = createValorantService({
      staticClient: new FakeValorantStaticClient(),
      henrikClient: new FakeValorantHenrikClient(),
      store: new InMemoryValorantLinkStore(),
    });

    await assert.rejects(
      () =>
        service.getRankCard({
          requesterId: 'self-user',
          name: 'ManualName',
        }),
      ValorantError,
    );
  });

  it('generates random comps and strats from supported static data', async () => {
    const service = createValorantService({
      staticClient: new FakeValorantStaticClient(),
      henrikClient: new FakeValorantHenrikClient(),
      store: new InMemoryValorantLinkStore(),
    });

    const comp = await service.getRandomComp();
    const strat = await service.getStrat({
      map: 'Ascent',
      site: 'A',
      tone: 'serious',
    });

    assert.equal(comp.length, 5);
    assert.match(strat.description, /Ascent/);
    assert.ok(strat.fields.some((field) => field.name === 'Call'));
  });

  it('builds single match scoreboard cards', async () => {
    const service = createValorantService({
      staticClient: new FakeValorantStaticClient(),
      henrikClient: new FakeValorantHenrikClient(),
      store: new InMemoryValorantLinkStore(),
    });

    const card = await service.getMatchCard({
      region: 'na',
      matchId: 'match-1',
    });

    assert.match(card.description, /Red 13/);
    assert.match(card.fields[0].value, /24\/12\/6/);
  });

  it('aggregates recent match stats into a profile card', async () => {
    const service = createValorantService({
      staticClient: new FakeValorantStaticClient(),
      henrikClient: new FakeValorantHenrikClient(),
      store: new InMemoryValorantLinkStore([createLink('self-user', 'Self')]),
    });

    const card = await service.getStatsCard({ requesterId: 'self-user' });

    assert.match(card.fields[0].value, /30\/27\/14/);
    assert.match(card.fields[1].value, /50%/);
    assert.match(card.fields[3].value, /Sova/);
  });

  it('builds server leaderboards from linked accounts', async () => {
    const service = createValorantService({
      staticClient: new FakeValorantStaticClient(),
      henrikClient: new FakeValorantHenrikClient(),
      store: new InMemoryValorantLinkStore([
        createLink('self-user', 'Self'),
        createLink('entry-user', 'Entry'),
      ]),
    });

    const card = await service.getLeaderboardCard({ sortBy: 'kda' });

    assert.equal(card.fields.length, 2);
    assert.doesNotMatch(card.fields[0].name, /<@/);
    assert.match(card.fields[0].value, /<@/);
  });

  it('filters server leaderboards to provided guild member ids', async () => {
    const service = createValorantService({
      staticClient: new FakeValorantStaticClient(),
      henrikClient: new FakeValorantHenrikClient(),
      store: new InMemoryValorantLinkStore([
        createLink('self-user', 'Self'),
        createLink('entry-user', 'Entry'),
      ]),
    });

    const card = await service.getLeaderboardCard({
      sortBy: 'rank',
      discordUserIds: ['entry-user'],
      displayNames: [{ discordUserId: 'entry-user', displayName: 'EntryDog' }],
    });

    assert.equal(card.fields.length, 1);
    assert.match(card.fields[0].name, /Entry#NA1/);
    assert.match(card.fields[0].value, /EntryDog/);
  });

  it('balances linked players into two teams', async () => {
    const service = createValorantService({
      staticClient: new FakeValorantStaticClient(),
      henrikClient: new FakeValorantHenrikClient(),
      store: new InMemoryValorantLinkStore([
        createLink('self-user', 'Self'),
        createLink('entry-user', 'Entry'),
      ]),
    });

    const card = await service.getTeamBalanceCard({
      players: [
        { discordUserId: 'self-user', displayName: 'Self' },
        { discordUserId: 'entry-user', displayName: 'Entry' },
      ],
    });

    assert.equal(card.fields.length, 2);
    assert.match(card.fields[0].value, /<@/);
  });
});

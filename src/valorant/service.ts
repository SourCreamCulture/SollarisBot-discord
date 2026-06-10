import { getValorantPlatformLabel, getValorantRegionLabel } from './platform';
import {
  ValorantError,
  type ValorantAccountCard,
  type ValorantAgent,
  type ValorantBaseCard,
  type ValorantHenrikClient,
  type ValorantLeaderboardCard,
  type ValorantLeaderboardDisplayName,
  type ValorantLeaderboardEntry,
  type ValorantLeaderboardSnapshot,
  type ValorantLinkStore,
  type ValorantLinkedAccount,
  type ValorantMatchesCard,
  type ValorantMatchCard,
  type ValorantMatchSummary,
  type ValorantRankCard,
  type ValorantResolvedTarget,
  type ValorantService,
  type ValorantStatsCard,
  type ValorantStatsSummary,
  type ValorantStaticClient,
  type ValorantTeamBalanceCard,
  type ValorantTeamBalancePlayer,
  type ValorantTargetRequest,
} from './types';

interface CreateValorantServiceOptions {
  staticClient: ValorantStaticClient;
  henrikClient: ValorantHenrikClient;
  store: ValorantLinkStore;
}

const VALORANT_COLOR = 0xff4655;

const normalizeSearch = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();

const formatRiotId = (name: string, tag: string): string => `${name}#${tag}`;

const truncate = (value: string, maxLength: number): string =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;

const formatNumber = (value: number | undefined): string =>
  value === undefined
    ? 'Unknown'
    : new Intl.NumberFormat('en-US').format(value);

const formatSigned = (value: number | undefined): string => {
  if (value === undefined) {
    return 'Unknown';
  }

  return value > 0 ? `+${value}` : String(value);
};

const formatLeaderboardMovementDirection = (
  current: ValorantLeaderboardEntry,
  previous: ValorantLeaderboardSnapshot,
): 'up' | 'down' | null => {
  if (current.elo !== undefined && previous.elo !== undefined) {
    if (current.elo > previous.elo) {
      return 'up';
    }

    if (current.elo < previous.elo) {
      return 'down';
    }
  }

  if (current.rr !== undefined && previous.rr !== undefined) {
    if (current.rr > previous.rr) {
      return 'up';
    }

    if (current.rr < previous.rr) {
      return 'down';
    }
  }

  return null;
};

const isSameLeaderboardAccount = (
  current: ValorantLeaderboardEntry,
  previous: ValorantLeaderboardSnapshot,
): boolean =>
  current.name === previous.name &&
  current.tag === previous.tag &&
  current.region === previous.region &&
  current.platform === previous.platform;

const formatLeaderboardMovement = (
  current: ValorantLeaderboardEntry,
  previous: ValorantLeaderboardSnapshot | undefined,
  isFirstSnapshot: boolean,
): string => {
  if (!previous) {
    return isFirstSnapshot ? 'first snapshot' : 'no previous snapshot';
  }

  if (!isSameLeaderboardAccount(current, previous)) {
    return 'new linked account';
  }

  if (current.rank !== previous.rank) {
    const direction = formatLeaderboardMovementDirection(current, previous);
    const label =
      direction === 'up'
        ? 'rank up'
        : direction === 'down'
          ? 'rank down'
          : 'rank changed';

    return `${label} from ${previous.rank}`;
  }

  if (current.rr !== undefined && previous.rr !== undefined) {
    const delta = current.rr - previous.rr;

    if (delta !== 0) {
      return `${formatSigned(delta)} RR`;
    }

    return 'no change';
  }

  if (current.rr !== undefined) {
    return 'RR now tracked';
  }

  return 'RR unavailable';
};

const createLeaderboardSnapshots = (
  entries: ValorantLeaderboardEntry[],
): Record<string, ValorantLeaderboardSnapshot> =>
  Object.fromEntries(
    entries.map((entry, index) => [
      entry.discordUserId,
      {
        discordUserId: entry.discordUserId,
        name: entry.name,
        tag: entry.tag,
        region: entry.region,
        platform: entry.platform,
        rank: entry.rank,
        rr: entry.rr,
        elo: entry.elo,
        leaderboardPosition: index + 1,
      },
    ]),
  );

const formatDate = (unixSeconds: number | undefined): string =>
  unixSeconds === undefined ? 'Unknown date' : `<t:${unixSeconds}:R>`;

const formatPercent = (value: number | undefined): string =>
  value === undefined ? 'Unknown' : `${Math.round(value)}%`;

const formatDecimal = (value: number | undefined): string =>
  value === undefined ? 'Unknown' : value.toFixed(2);

const getKda = (kills = 0, deaths = 0, assists = 0): number =>
  (kills + assists) / Math.max(deaths, 1);

const getHsPercent = (
  headshots = 0,
  bodyshots = 0,
  legshots = 0,
): number | undefined => {
  const shots = headshots + bodyshots + legshots;
  return shots > 0 ? (headshots / shots) * 100 : undefined;
};

const calculateHeadshotPercent = (match: ValorantMatchSummary): string => {
  const shots =
    (match.headshots ?? 0) + (match.bodyshots ?? 0) + (match.legshots ?? 0);

  if (!shots || match.headshots === undefined) {
    return 'HS unknown';
  }

  return `${Math.round((match.headshots / shots) * 100)}% HS`;
};

const shuffle = <T>(values: T[]): T[] => {
  const copy = [...values];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }

  return copy;
};

const aggregateMatches = (
  matches: ValorantMatchSummary[],
): ValorantStatsSummary => {
  const agentCounts = new Map<string, number>();
  const summary = matches.reduce<ValorantStatsSummary>(
    (accumulator, match) => {
      accumulator.matches += 1;
      accumulator.wins += match.result === 'Win' ? 1 : 0;
      accumulator.losses += match.result === 'Loss' ? 1 : 0;
      accumulator.kills += match.kills ?? 0;
      accumulator.deaths += match.deaths ?? 0;
      accumulator.assists += match.assists ?? 0;
      accumulator.headshots += match.headshots ?? 0;
      accumulator.bodyshots += match.bodyshots ?? 0;
      accumulator.legshots += match.legshots ?? 0;

      if (match.character) {
        agentCounts.set(
          match.character,
          (agentCounts.get(match.character) ?? 0) + 1,
        );
      }

      return accumulator;
    },
    {
      matches: 0,
      wins: 0,
      losses: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
      headshots: 0,
      bodyshots: 0,
      legshots: 0,
      mostPlayedAgents: [],
    },
  );

  summary.mostPlayedAgents = [...agentCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([agent, count]) => ({ agent, matches: count }));

  return summary;
};

const getRankSortValue = (entry: ValorantLeaderboardEntry): number =>
  entry.elo ?? 0;

const getLeaderboardSortValue = (
  entry: ValorantLeaderboardEntry,
  sortBy: 'rank' | 'kda' | 'winrate' | 'hs',
): number => {
  switch (sortBy) {
    case 'kda':
      return entry.kda ?? 0;
    case 'winrate':
      return entry.winrate ?? 0;
    case 'hs':
      return entry.hsPercent ?? 0;
    case 'rank':
      return getRankSortValue(entry);
  }
};

const findByName = <T extends { displayName: string }>(
  values: T[],
  name: string,
  kind: string,
): T => {
  const requested = normalizeSearch(name);
  const exact = values.find(
    (value) => normalizeSearch(value.displayName) === requested,
  );

  if (exact) {
    return exact;
  }

  const partial = values.find((value) =>
    normalizeSearch(value.displayName).includes(requested),
  );

  if (partial) {
    return partial;
  }

  throw new ValorantError('not_found', `That Valorant ${kind} was not found.`);
};

const listChoices = <T extends { displayName: string }>(
  values: T[],
  query: string,
): string[] => {
  const normalized = normalizeSearch(query);

  return values
    .filter(
      (value) =>
        !normalized || normalizeSearch(value.displayName).includes(normalized),
    )
    .slice(0, 25)
    .map((value) => value.displayName);
};

const getMissingLinkMessage = (source: 'member' | 'self'): string =>
  source === 'member'
    ? 'That Discord member has not linked a Valorant account yet.'
    : 'You have not linked a Valorant account yet. Use `/valorant link` first.';

const buildTargetFooter = (target: ValorantResolvedTarget): string =>
  [
    `${getValorantRegionLabel(target.region)} - ${getValorantPlatformLabel(
      target.platform,
    )}`,
    target.source === 'manual' ? 'Manual lookup' : 'Linked account',
  ].join(' - ');

const createBaseCard = (
  title: string,
  description: string,
  target: ValorantResolvedTarget,
): ValorantBaseCard => ({
  title,
  description,
  color: VALORANT_COLOR,
  fields: [],
  footer: buildTargetFooter(target),
});

const createUtilityCard = (
  title: string,
  description: string,
): ValorantBaseCard => ({
  title,
  description,
  color: VALORANT_COLOR,
  fields: [],
  footer: 'Valorant utility',
});

const SERIOUS_STRATS = [
  'Default early, hold for defender utility, then split late through mid when contact is made.',
  'Play slow for first pick, regroup, and hit with two pieces of utility before the spike crosses choke.',
  'Fake pressure on the opposite site, leave one lurk behind, then pivot quickly once rotations move.',
  'Take map control in pairs, trade every first contact, and save one smoke or flash for post-plant.',
  'Use a contact walk until first noise, then explode together and clear close corners before planting.',
];

const SILLY_STRATS = [
  'Everyone crouch-walks like it is a museum heist, then full-sends the site when someone giggles.',
  'Five-stack the smallest doorway available and let confidence do the entry fragging.',
  'Declare one player the main character and spend every piece of utility helping them plant.',
  'Rotate every time someone says the map name. Commitment is optional; confusion is mandatory.',
  'Buy judges, pick a corner, and become a deeply inconvenient surprise.',
];

class DefaultValorantService implements ValorantService {
  constructor(
    private readonly staticClient: ValorantStaticClient,
    private readonly henrikClient: ValorantHenrikClient,
    private readonly store: ValorantLinkStore,
  ) {}

  async findAgent(name: string): Promise<ValorantAgent> {
    const agents = await this.staticClient.getAgents();
    return findByName(agents, name, 'agent');
  }

  async findMap(name: string) {
    const maps = await this.staticClient.getMaps();
    return findByName(maps, name, 'map');
  }

  async findWeapon(name: string) {
    const weapons = await this.staticClient.getWeapons();
    return findByName(weapons, name, 'weapon');
  }

  async getRandomAgent(role?: string): Promise<ValorantAgent> {
    const agents = await this.staticClient.getAgents();
    const normalizedRole = role ? normalizeSearch(role) : undefined;
    const filtered = normalizedRole
      ? agents.filter(
          (agent) =>
            normalizeSearch(agent.role?.displayName ?? '') === normalizedRole,
        )
      : agents;

    if (filtered.length === 0) {
      throw new ValorantError(
        'not_found',
        'No Valorant agents matched that role.',
      );
    }

    return filtered[Math.floor(Math.random() * filtered.length)];
  }

  async getRandomComp(): Promise<ValorantAgent[]> {
    const agents = await this.staticClient.getAgents();
    const selected: ValorantAgent[] = [];
    const takeRole = (role: string): void => {
      const candidates = agents.filter(
        (agent) =>
          normalizeSearch(agent.role?.displayName ?? '') ===
            normalizeSearch(role) &&
          !selected.some((existing) => existing.uuid === agent.uuid),
      );

      if (candidates.length > 0) {
        selected.push(shuffle(candidates)[0]);
      }
    };

    for (const role of ['Controller', 'Duelist', 'Initiator', 'Sentinel']) {
      takeRole(role);
    }

    const remaining = shuffle(
      agents.filter(
        (agent) => !selected.some((existing) => existing.uuid === agent.uuid),
      ),
    );

    return [...selected, ...remaining].slice(0, 5);
  }

  async getStrat(input: {
    map?: string;
    site?: string;
    tone?: 'serious' | 'silly';
  }): Promise<ValorantBaseCard> {
    const map = input.map ? await this.findMap(input.map) : undefined;
    const tone = input.tone ?? 'serious';
    const site = input.site?.toUpperCase();
    const stratPool = tone === 'silly' ? SILLY_STRATS : SERIOUS_STRATS;
    const strat = shuffle(stratPool)[0];
    const target = [map?.displayName, site ? `${site} site` : undefined]
      .filter(Boolean)
      .join(' - ');
    const card = createUtilityCard(
      tone === 'silly' ? 'Valorant Chaos Strat' : 'Valorant Strat',
      target ? `Target: **${target}**` : 'Target: **Any map/site**',
    );

    card.fields.push({
      name: 'Call',
      value: strat,
      inline: false,
    });

    if (map?.tacticalDescription || map?.calloutCount) {
      card.fields.push({
        name: 'Map Note',
        value: [
          map.tacticalDescription
            ? `Layout: ${map.tacticalDescription}`
            : undefined,
          map.calloutCount ? `${map.calloutCount} known callouts` : undefined,
        ]
          .filter(Boolean)
          .join(' - '),
        inline: false,
      });
    }

    card.imageUrl = map?.splash;

    return card;
  }

  async listAgentChoices(query: string): Promise<string[]> {
    return listChoices(await this.staticClient.getAgents(), query);
  }

  async listMapChoices(query: string): Promise<string[]> {
    return listChoices(await this.staticClient.getMaps(), query);
  }

  async listWeaponChoices(query: string): Promise<string[]> {
    return listChoices(await this.staticClient.getWeapons(), query);
  }

  getLinkedAccount(discordUserId: string): ValorantLinkedAccount | null {
    return this.store.getLink(discordUserId);
  }

  async linkAccount(input: {
    discordUserId: string;
    name: string;
    tag: string;
    region: ValorantResolvedTarget['region'];
    platform: ValorantResolvedTarget['platform'];
  }): Promise<ValorantLinkedAccount> {
    const name = input.name.trim();
    const tag = input.tag.trim();

    if (!name || !tag) {
      throw new ValorantError(
        'invalid_target',
        'Provide both a Valorant name and tag.',
      );
    }

    const account = await this.henrikClient.getAccount({ name, tag });
    const now = new Date().toISOString();
    const existing = this.store.getLink(input.discordUserId);
    const link: ValorantLinkedAccount = {
      discordUserId: input.discordUserId,
      name: account.name,
      tag: account.tag,
      region: input.region,
      platform: input.platform,
      puuid: account.puuid,
      accountLevel: account.accountLevel,
      cardUrl: account.cardUrl,
      linkedAt: existing?.linkedAt ?? now,
      updatedAt: now,
    };

    await this.store.setLink(link);
    return link;
  }

  async unlinkAccount(discordUserId: string): Promise<boolean> {
    return this.store.deleteLink(discordUserId);
  }

  async getAccountCard(
    input: ValorantTargetRequest,
  ): Promise<ValorantAccountCard> {
    const target = this.resolveTarget(input);
    const [account, mmr] = await Promise.all([
      this.henrikClient.getAccount(target),
      this.henrikClient.getMmr(target),
    ]);
    const card = createBaseCard(
      `${formatRiotId(account.name, account.tag)} Valorant`,
      `Account overview for **${formatRiotId(account.name, account.tag)}**.`,
      target,
    );

    card.thumbnailUrl = account.cardUrl;
    card.fields.push(
      {
        name: 'Current Rank',
        value: `${mmr.currentTier}${mmr.rr === undefined ? '' : ` - ${mmr.rr} RR`}`,
        inline: true,
      },
      {
        name: 'Peak Rank',
        value: mmr.peakTier
          ? `${mmr.peakTier}${mmr.peakSeason ? ` (${mmr.peakSeason})` : ''}`
          : 'Unknown',
        inline: true,
      },
      {
        name: 'Account Level',
        value: formatNumber(account.accountLevel),
        inline: true,
      },
    );

    if (account.title) {
      card.fields.push({
        name: 'Title',
        value: account.title,
        inline: true,
      });
    }

    return card;
  }

  async getRankCard(input: ValorantTargetRequest): Promise<ValorantRankCard> {
    const target = this.resolveTarget(input);
    const mmr = await this.henrikClient.getMmr(target);
    const card = createBaseCard(
      `${formatRiotId(mmr.accountName, mmr.accountTag)} Rank`,
      `Competitive rank for **${formatRiotId(
        mmr.accountName,
        mmr.accountTag,
      )}**.`,
      target,
    );

    card.fields.push(
      {
        name: 'Current',
        value: `${mmr.currentTier}${mmr.rr === undefined ? '' : ` - ${mmr.rr} RR`}`,
        inline: true,
      },
      {
        name: 'Last Change',
        value: formatSigned(mmr.lastChange),
        inline: true,
      },
      {
        name: 'Elo',
        value: formatNumber(mmr.elo),
        inline: true,
      },
      {
        name: 'Peak',
        value: mmr.peakTier
          ? `${mmr.peakTier}${mmr.peakSeason ? ` (${mmr.peakSeason})` : ''}`
          : 'Unknown',
        inline: true,
      },
      {
        name: 'Leaderboard',
        value:
          mmr.leaderboardRank === undefined
            ? 'Not listed'
            : `#${formatNumber(mmr.leaderboardRank)}`,
        inline: true,
      },
      {
        name: 'Current Act',
        value:
          mmr.seasonalWins === undefined && mmr.seasonalGames === undefined
            ? 'Unknown'
            : `${formatNumber(mmr.seasonalWins)} wins / ${formatNumber(
                mmr.seasonalGames,
              )} games`,
        inline: true,
      },
    );

    return card;
  }

  async getMatchesCard(
    input: ValorantTargetRequest & { size?: number; mode?: string },
  ): Promise<ValorantMatchesCard> {
    const target = this.resolveTarget(input);
    const size = input.size ?? 5;
    const matches = await this.henrikClient.getMatches({
      ...target,
      size,
      mode: input.mode,
    });
    const card = createBaseCard(
      `${formatRiotId(target.name, target.tag)} Recent Matches`,
      matches.length
        ? `Recent Valorant matches for **${formatRiotId(
            target.name,
            target.tag,
          )}**.`
        : `No recent Valorant matches found for **${formatRiotId(
            target.name,
            target.tag,
          )}**.`,
      target,
    );

    card.fields = matches.slice(0, 10).map((match) => ({
      name: `${match.result ?? 'Unknown'} - ${match.map} - ${match.mode}`,
      value: truncate(
        [
          `${match.character ?? 'Unknown Agent'}${
            match.tier ? ` - ${match.tier}` : ''
          }`,
          `${formatNumber(match.kills)}/${formatNumber(
            match.deaths,
          )}/${formatNumber(match.assists)} KDA`,
          calculateHeadshotPercent(match),
          match.roundsPlayed ? `${match.roundsPlayed} rounds` : undefined,
          formatDate(match.startedAt),
        ]
          .filter(Boolean)
          .join(' - '),
        1024,
      ),
      inline: false,
    }));

    return card;
  }

  async getMatchCard(input: {
    region: ValorantResolvedTarget['region'];
    matchId: string;
  }): Promise<ValorantMatchCard> {
    const match = await this.henrikClient.getMatch(input);
    const card = createUtilityCard(
      `${match.map} - ${match.mode}`,
      [
        match.matchId ? `Match: \`${match.matchId}\`` : undefined,
        match.roundsPlayed ? `${match.roundsPlayed} rounds` : undefined,
        match.winningTeam ? `Winner: **${match.winningTeam}**` : undefined,
        match.redRounds !== undefined || match.blueRounds !== undefined
          ? `Score: **Red ${formatNumber(match.redRounds)} - ${formatNumber(
              match.blueRounds,
            )} Blue**`
          : undefined,
        formatDate(match.startedAt),
      ]
        .filter(Boolean)
        .join('\n'),
    );

    const topPlayers = match.players.slice(0, 10);
    card.fields = topPlayers.map((player, index) => ({
      name: `${index + 1}. ${formatRiotId(player.name, player.tag)}`,
      value: [
        player.team,
        player.character,
        player.tier,
        `${formatNumber(player.kills)}/${formatNumber(
          player.deaths,
        )}/${formatNumber(player.assists)} KDA`,
        `Score ${formatNumber(player.score)}`,
      ]
        .filter(Boolean)
        .join(' - '),
      inline: false,
    }));
    card.footer = `HenrikDev match data - ${getValorantRegionLabel(
      input.region,
    )}`;

    return card;
  }

  async getStatsCard(
    input: ValorantTargetRequest & { size?: number; mode?: string },
  ): Promise<ValorantStatsCard> {
    const target = this.resolveTarget(input);
    const matches = await this.henrikClient.getMatches({
      ...target,
      size: input.size ?? 10,
      mode: input.mode,
    });
    const stats = aggregateMatches(matches);
    const card = createBaseCard(
      `${formatRiotId(target.name, target.tag)} Stats`,
      `Recent performance across **${stats.matches}** Valorant match(es).`,
      target,
    );
    const winrate =
      stats.wins + stats.losses > 0
        ? (stats.wins / (stats.wins + stats.losses)) * 100
        : undefined;

    card.fields.push(
      {
        name: 'KDA',
        value: `${formatNumber(stats.kills)}/${formatNumber(
          stats.deaths,
        )}/${formatNumber(stats.assists)} (${formatDecimal(
          getKda(stats.kills, stats.deaths, stats.assists),
        )})`,
        inline: true,
      },
      {
        name: 'Winrate',
        value: `${formatPercent(winrate)} (${stats.wins}W/${stats.losses}L)`,
        inline: true,
      },
      {
        name: 'Headshot',
        value: formatPercent(
          getHsPercent(stats.headshots, stats.bodyshots, stats.legshots),
        ),
        inline: true,
      },
      {
        name: 'Most Played Agents',
        value: stats.mostPlayedAgents.length
          ? stats.mostPlayedAgents
              .map((agent) => `${agent.agent} (${agent.matches})`)
              .join(', ')
          : 'Unknown',
        inline: false,
      },
    );

    return card;
  }

  async getLeaderboardCard(input: {
    sortBy?: 'rank' | 'kda' | 'winrate' | 'hs';
    size?: number;
    mode?: string;
    discordUserIds?: string[];
    displayNames?: ValorantLeaderboardDisplayName[];
    previousSnapshots?: Record<string, ValorantLeaderboardSnapshot>;
  }): Promise<ValorantLeaderboardCard> {
    const allowedUserIds = input.discordUserIds
      ? new Set(input.discordUserIds)
      : null;
    const links = this.store
      .getAllLinks()
      .filter(
        (link) => !allowedUserIds || allowedUserIds.has(link.discordUserId),
      );

    if (links.length === 0) {
      throw new ValorantError(
        'not_found',
        'No linked Valorant accounts are available for the server leaderboard.',
      );
    }

    const sortBy = input.sortBy ?? 'rank';
    const displayNames = new Map(
      input.displayNames?.map((user) => [user.discordUserId, user.displayName]),
    );
    const entries = await Promise.all(
      links.map(async (link): Promise<ValorantLeaderboardEntry | null> => {
        try {
          const [mmr, matches] = await Promise.all([
            this.henrikClient.getMmr(link),
            sortBy === 'rank'
              ? Promise.resolve<ValorantMatchSummary[]>([])
              : this.henrikClient.getMatches({
                  ...link,
                  size: input.size ?? 10,
                  mode: input.mode,
                }),
          ]);
          const stats = aggregateMatches(matches);
          const winrate =
            stats.wins + stats.losses > 0
              ? (stats.wins / (stats.wins + stats.losses)) * 100
              : undefined;

          return {
            discordUserId: link.discordUserId,
            name: link.name,
            tag: link.tag,
            region: link.region,
            platform: link.platform,
            rank: mmr.currentTier,
            rr: mmr.rr,
            elo: mmr.elo,
            kda:
              matches.length > 0
                ? getKda(stats.kills, stats.deaths, stats.assists)
                : undefined,
            winrate,
            hsPercent: getHsPercent(
              stats.headshots,
              stats.bodyshots,
              stats.legshots,
            ),
            matches: matches.length,
          };
        } catch {
          return null;
        }
      }),
    );
    const sorted = entries
      .filter((entry): entry is ValorantLeaderboardEntry => Boolean(entry))
      .sort(
        (left, right) =>
          getLeaderboardSortValue(right, sortBy) -
          getLeaderboardSortValue(left, sortBy),
      );
    const ranked = sorted.slice(0, 10);
    const snapshots = createLeaderboardSnapshots(sorted);

    if (ranked.length === 0) {
      throw new ValorantError(
        'provider_error',
        'No linked Valorant accounts could be refreshed for the leaderboard.',
      );
    }

    const card = createUtilityCard(
      'Valorant Server Leaderboard',
      `Sorted by **${sortBy.toUpperCase()}**.`,
    ) as ValorantLeaderboardCard;
    const shouldShowMovement = input.previousSnapshots !== undefined;
    const isFirstSnapshot =
      shouldShowMovement &&
      Object.keys(input.previousSnapshots ?? {}).length === 0;

    card.fields = ranked.map((entry, index) => ({
      name: `${index + 1}. ${formatRiotId(entry.name, entry.tag)}`,
      value: [
        displayNames.has(entry.discordUserId)
          ? `<@${entry.discordUserId}> - ${displayNames.get(entry.discordUserId)}`
          : `<@${entry.discordUserId}>`,
        `${entry.rank}${entry.rr === undefined ? '' : ` - ${entry.rr} RR`}${
          shouldShowMovement
            ? ` (${formatLeaderboardMovement(
                entry,
                input.previousSnapshots?.[entry.discordUserId],
                isFirstSnapshot,
              )})`
            : ''
        }`,
        entry.elo === undefined ? undefined : `Elo ${formatNumber(entry.elo)}`,
        entry.kda === undefined ? undefined : `KDA ${formatDecimal(entry.kda)}`,
        entry.winrate === undefined
          ? undefined
          : `WR ${formatPercent(entry.winrate)}`,
        entry.hsPercent === undefined
          ? undefined
          : `HS ${formatPercent(entry.hsPercent)}`,
      ]
        .filter(Boolean)
        .join(' - '),
      inline: false,
    }));
    card.snapshots = snapshots;

    return card;
  }

  async getTeamBalanceCard(input: {
    players: Array<{ discordUserId: string; displayName: string }>;
  }): Promise<ValorantTeamBalanceCard> {
    const uniquePlayers = [
      ...new Map(
        input.players.map((player) => [player.discordUserId, player]),
      ).values(),
    ];

    if (uniquePlayers.length < 2) {
      throw new ValorantError(
        'invalid_target',
        'Choose at least two linked players to balance teams.',
      );
    }

    const players = await Promise.all(
      uniquePlayers.map(async (player): Promise<ValorantTeamBalancePlayer> => {
        const link = this.store.getLink(player.discordUserId);

        if (!link) {
          throw new ValorantError(
            'not_found',
            `${player.displayName} has not linked a Valorant account yet.`,
          );
        }

        const mmr = await this.henrikClient.getMmr(link);

        return {
          discordUserId: player.discordUserId,
          displayName: player.displayName,
          rank: mmr.currentTier,
          elo: mmr.elo ?? 0,
        };
      }),
    );
    const sorted = [...players].sort((left, right) => right.elo - left.elo);
    const teamA: ValorantTeamBalancePlayer[] = [];
    const teamB: ValorantTeamBalancePlayer[] = [];
    let teamAScore = 0;
    let teamBScore = 0;

    for (const player of sorted) {
      if (teamAScore <= teamBScore) {
        teamA.push(player);
        teamAScore += player.elo;
      } else {
        teamB.push(player);
        teamBScore += player.elo;
      }
    }

    const formatTeam = (team: ValorantTeamBalancePlayer[]): string =>
      team
        .map(
          (player) =>
            `<@${player.discordUserId}> - ${player.rank} (${formatNumber(
              player.elo,
            )})`,
        )
        .join('\n') || 'No players';

    const card = createUtilityCard(
      'Valorant Team Balance',
      'Teams are balanced from linked account MMR/elo when HenrikDev provides it.',
    );
    card.fields.push(
      {
        name: `Team A - ${formatNumber(teamAScore)} elo`,
        value: formatTeam(teamA),
        inline: true,
      },
      {
        name: `Team B - ${formatNumber(teamBScore)} elo`,
        value: formatTeam(teamB),
        inline: true,
      },
    );

    return card;
  }

  private resolveTarget(input: ValorantTargetRequest): ValorantResolvedTarget {
    if (input.memberId) {
      const link = this.store.getLink(input.memberId);

      if (!link) {
        throw new ValorantError('not_found', getMissingLinkMessage('member'));
      }

      return {
        source: 'member',
        discordUserId: input.memberId,
        name: link.name,
        tag: link.tag,
        region: link.region,
        platform: link.platform,
      };
    }

    const hasManualInput =
      input.name !== undefined ||
      input.tag !== undefined ||
      input.region !== undefined ||
      input.platform !== undefined;

    if (hasManualInput) {
      if (!input.name?.trim() || !input.tag?.trim() || !input.region) {
        throw new ValorantError(
          'invalid_target',
          'Manual Valorant lookups need name, tag, and region.',
        );
      }

      return {
        source: 'manual',
        name: input.name.trim(),
        tag: input.tag.trim(),
        region: input.region,
        platform: input.platform ?? 'pc',
      };
    }

    const link = this.store.getLink(input.requesterId);

    if (!link) {
      throw new ValorantError('not_found', getMissingLinkMessage('self'));
    }

    return {
      source: 'self',
      discordUserId: input.requesterId,
      name: link.name,
      tag: link.tag,
      region: link.region,
      platform: link.platform,
    };
  }
}

export const createValorantService = ({
  staticClient,
  henrikClient,
  store,
}: CreateValorantServiceOptions): ValorantService =>
  new DefaultValorantService(staticClient, henrikClient, store);

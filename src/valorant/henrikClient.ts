import type { Logger } from '../utils/logger';
import {
  ValorantError,
  type ValorantAccount,
  type ValorantHenrikClient,
  type ValorantMatchDetails,
  type ValorantMatchPlayer,
  type ValorantMatchSummary,
  type ValorantMmr,
  type ValorantPlatform,
  type ValorantRegion,
} from './types';

const HENRIK_API_BASE_URL = 'https://api.henrikdev.xyz/valorant';
const REQUEST_TIMEOUT_MS = 12_000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toStringOrUndefined = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

const toNumberOrUndefined = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const encodePath = (value: string): string => encodeURIComponent(value.trim());

const firstNumber = (...values: unknown[]): number | undefined => {
  for (const value of values) {
    const number = toNumberOrUndefined(value);

    if (number !== undefined) {
      return number;
    }
  }

  return undefined;
};

const getNestedObject = (
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> => (isObject(value[key]) ? value[key] : {});

const normalizeCardUrl = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value.startsWith('http') ? value : undefined;
  }

  if (!isObject(value)) {
    return undefined;
  }

  return (
    toStringOrUndefined(value.wide) ??
    toStringOrUndefined(value.large) ??
    toStringOrUndefined(value.small)
  );
};

const normalizeAccount = (value: unknown): ValorantAccount => {
  if (!isObject(value)) {
    throw new ValorantError(
      'provider_error',
      'HenrikDev returned an invalid Valorant account payload.',
    );
  }

  const name = toStringOrUndefined(value.name);
  const tag = toStringOrUndefined(value.tag);

  if (!name || !tag) {
    throw new ValorantError(
      'provider_error',
      'HenrikDev did not return a complete Valorant account.',
    );
  }

  return {
    puuid: toStringOrUndefined(value.puuid),
    region: toStringOrUndefined(value.region),
    accountLevel: toNumberOrUndefined(value.account_level),
    name,
    tag,
    cardUrl: normalizeCardUrl(value.card),
    title: toStringOrUndefined(value.title),
    platforms: Array.isArray(value.platforms)
      ? value.platforms.filter(
          (platform): platform is string => typeof platform === 'string',
        )
      : undefined,
    updatedAt:
      toStringOrUndefined(value.updated_at) ??
      toStringOrUndefined(value.last_update),
  };
};

const normalizeMmr = (value: unknown): ValorantMmr => {
  if (!isObject(value)) {
    throw new ValorantError(
      'provider_error',
      'HenrikDev returned an invalid Valorant rank payload.',
    );
  }

  const account = getNestedObject(value, 'account');
  const current = getNestedObject(value, 'current');
  const currentTier = getNestedObject(current, 'tier');
  const peak = getNestedObject(value, 'peak');
  const peakTier = getNestedObject(peak, 'tier');
  const peakSeason = getNestedObject(peak, 'season');
  const currentData = getNestedObject(value, 'current_data');
  const highestRank = getNestedObject(value, 'highest_rank');
  const leaderboard = getNestedObject(current, 'leaderboard_placement');
  const seasonal = Array.isArray(value.seasonal) ? value.seasonal[0] : {};

  return {
    accountName:
      toStringOrUndefined(account.name) ??
      toStringOrUndefined(value.name) ??
      'Unknown',
    accountTag:
      toStringOrUndefined(account.tag) ??
      toStringOrUndefined(value.tag) ??
      '???',
    currentTier:
      toStringOrUndefined(currentTier.name) ??
      toStringOrUndefined(currentData.currenttier_patched) ??
      'Unrated',
    rr: firstNumber(current.rr, currentData.ranking_in_tier),
    lastChange: firstNumber(
      current.last_change,
      currentData.mmr_change_to_last_game,
    ),
    elo: firstNumber(current.elo, currentData.elo),
    peakTier:
      toStringOrUndefined(peakTier.name) ??
      toStringOrUndefined(highestRank.patched_tier),
    peakSeason:
      toStringOrUndefined(peakSeason.short) ??
      toStringOrUndefined(highestRank.season),
    leaderboardRank: firstNumber(leaderboard.rank),
    seasonalWins: isObject(seasonal) ? firstNumber(seasonal.wins) : undefined,
    seasonalGames: isObject(seasonal) ? firstNumber(seasonal.games) : undefined,
  };
};

const normalizeMatch = (
  value: unknown,
  name: string,
  tag: string,
): ValorantMatchSummary | undefined => {
  if (!isObject(value)) {
    return undefined;
  }

  const metadata = getNestedObject(value, 'metadata');
  const players = getNestedObject(value, 'players');
  const allPlayers = Array.isArray(players.all_players)
    ? players.all_players.filter(isObject)
    : [];
  const player = allPlayers.find(
    (candidate) =>
      toStringOrUndefined(candidate.name)?.toLowerCase() ===
        name.toLowerCase() &&
      toStringOrUndefined(candidate.tag)?.toLowerCase() === tag.toLowerCase(),
  );
  const stats = player ? getNestedObject(player, 'stats') : {};
  const teams = getNestedObject(value, 'teams');
  const team = player ? toStringOrUndefined(player.team) : undefined;
  const teamDetails =
    team && isObject(teams[team.toLowerCase()])
      ? teams[team.toLowerCase()]
      : {};
  const hasWon =
    isObject(teamDetails) && typeof teamDetails.has_won === 'boolean'
      ? teamDetails.has_won
      : undefined;

  return {
    matchId: toStringOrUndefined(metadata.matchid),
    map: toStringOrUndefined(metadata.map) ?? 'Unknown Map',
    mode:
      toStringOrUndefined(metadata.mode) ??
      toStringOrUndefined(metadata.mode_id) ??
      'Unknown Mode',
    startedAt: toNumberOrUndefined(metadata.game_start),
    roundsPlayed: toNumberOrUndefined(metadata.rounds_played),
    character: player ? toStringOrUndefined(player.character) : undefined,
    tier: player ? toStringOrUndefined(player.currenttier_patched) : undefined,
    team,
    result: hasWon === undefined ? 'Unknown' : hasWon ? 'Win' : 'Loss',
    kills: firstNumber(stats.kills),
    deaths: firstNumber(stats.deaths),
    assists: firstNumber(stats.assists),
    headshots: firstNumber(stats.headshots),
    bodyshots: firstNumber(stats.bodyshots),
    legshots: firstNumber(stats.legshots),
  };
};

const normalizeMatchPlayer = (
  value: unknown,
): ValorantMatchPlayer | undefined => {
  if (!isObject(value)) {
    return undefined;
  }

  const name = toStringOrUndefined(value.name);
  const tag = toStringOrUndefined(value.tag);

  if (!name || !tag) {
    return undefined;
  }

  const stats = getNestedObject(value, 'stats');

  return {
    name,
    tag,
    team: toStringOrUndefined(value.team),
    character: toStringOrUndefined(value.character),
    tier: toStringOrUndefined(value.currenttier_patched),
    kills: firstNumber(stats.kills),
    deaths: firstNumber(stats.deaths),
    assists: firstNumber(stats.assists),
    score: firstNumber(stats.score),
    headshots: firstNumber(stats.headshots),
    bodyshots: firstNumber(stats.bodyshots),
    legshots: firstNumber(stats.legshots),
  };
};

const normalizeMatchDetails = (value: unknown): ValorantMatchDetails => {
  if (!isObject(value)) {
    throw new ValorantError(
      'provider_error',
      'HenrikDev returned an invalid Valorant match payload.',
    );
  }

  const metadata = getNestedObject(value, 'metadata');
  const players = getNestedObject(value, 'players');
  const teams = getNestedObject(value, 'teams');
  const red = getNestedObject(teams, 'red');
  const blue = getNestedObject(teams, 'blue');
  const redWon = typeof red.has_won === 'boolean' ? red.has_won : undefined;
  const blueWon = typeof blue.has_won === 'boolean' ? blue.has_won : undefined;
  const allPlayers = Array.isArray(players.all_players)
    ? players.all_players
        .map((player) => normalizeMatchPlayer(player))
        .filter((player): player is ValorantMatchPlayer => Boolean(player))
    : [];

  return {
    matchId: toStringOrUndefined(metadata.matchid),
    map: toStringOrUndefined(metadata.map) ?? 'Unknown Map',
    mode:
      toStringOrUndefined(metadata.mode) ??
      toStringOrUndefined(metadata.mode_id) ??
      'Unknown Mode',
    region: toStringOrUndefined(metadata.region),
    startedAt: toNumberOrUndefined(metadata.game_start),
    roundsPlayed: toNumberOrUndefined(metadata.rounds_played),
    redRounds: firstNumber(red.rounds_won),
    blueRounds: firstNumber(blue.rounds_won),
    winningTeam: redWon ? 'Red' : blueWon ? 'Blue' : undefined,
    players: allPlayers.sort(
      (left, right) => (right.score ?? 0) - (left.score ?? 0),
    ),
  };
};

class DefaultValorantHenrikClient implements ValorantHenrikClient {
  constructor(
    private readonly apiKey: string | undefined,
    private readonly logger: Logger,
  ) {}

  async getAccount(input: {
    name: string;
    tag: string;
  }): Promise<ValorantAccount> {
    const payload = await this.requestJson(
      `/v2/account/${encodePath(input.name)}/${encodePath(input.tag)}`,
    );
    return normalizeAccount(isObject(payload) ? payload.data : undefined);
  }

  async getMmr(input: {
    region: ValorantRegion;
    platform: ValorantPlatform;
    name: string;
    tag: string;
  }): Promise<ValorantMmr> {
    const payload = await this.requestJson(
      `/v3/mmr/${input.region}/${input.platform}/${encodePath(
        input.name,
      )}/${encodePath(input.tag)}`,
    );
    return normalizeMmr(isObject(payload) ? payload.data : undefined);
  }

  async getMatches(input: {
    region: ValorantRegion;
    platform: ValorantPlatform;
    name: string;
    tag: string;
    size: number;
    mode?: string;
  }): Promise<ValorantMatchSummary[]> {
    const params = new URLSearchParams({
      size: String(Math.min(Math.max(input.size, 1), 10)),
    });

    if (input.mode) {
      params.set('mode', input.mode);
    }

    const payload = await this.requestJson(
      `/v4/matches/${input.region}/${input.platform}/${encodePath(
        input.name,
      )}/${encodePath(input.tag)}?${params.toString()}`,
    );
    const data = isObject(payload) ? payload.data : undefined;

    if (!Array.isArray(data)) {
      throw new ValorantError(
        'provider_error',
        'HenrikDev returned an invalid Valorant match payload.',
      );
    }

    return data
      .map((match) => normalizeMatch(match, input.name, input.tag))
      .filter((match): match is ValorantMatchSummary => Boolean(match));
  }

  async getMatch(input: {
    region: ValorantRegion;
    matchId: string;
  }): Promise<ValorantMatchDetails> {
    const payload = await this.requestJson(
      `/v4/match/${input.region}/${encodePath(input.matchId)}`,
    );
    return normalizeMatchDetails(isObject(payload) ? payload.data : undefined);
  }

  private async requestJson(path: string): Promise<Record<string, unknown>> {
    if (!this.apiKey) {
      throw new ValorantError(
        'config',
        'HENRIKDEV_API_KEY is required for Valorant account, rank, and match commands.',
      );
    }

    const response = await fetch(`${HENRIK_API_BASE_URL}${path}`, {
      headers: {
        Authorization: this.apiKey,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.status === 404) {
      throw new ValorantError(
        'not_found',
        'That Valorant account or match history could not be found.',
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new ValorantError(
        'config',
        'HenrikDev rejected the configured API key. Confirm HENRIKDEV_API_KEY is correct.',
      );
    }

    if (response.status === 429) {
      throw new ValorantError(
        'provider_error',
        'HenrikDev rate limited the Valorant request. Please try again later.',
      );
    }

    if (!response.ok) {
      const body = await response.text();
      this.logger.warn(
        `HenrikDev Valorant request failed with status ${response.status}.`,
        body,
      );

      throw new ValorantError(
        'provider_error',
        'HenrikDev could not return Valorant data right now. Please try again later.',
      );
    }

    const payload = (await response.json()) as unknown;

    if (!isObject(payload)) {
      throw new ValorantError(
        'provider_error',
        'HenrikDev returned an invalid Valorant payload.',
      );
    }

    return payload;
  }
}

export const createValorantHenrikClient = (
  apiKey: string | undefined,
  logger: Logger,
): ValorantHenrikClient => new DefaultValorantHenrikClient(apiKey, logger);

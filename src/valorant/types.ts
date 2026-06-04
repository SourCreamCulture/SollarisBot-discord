export type ValorantRegion = 'na' | 'eu' | 'ap' | 'kr' | 'latam' | 'br';
export type ValorantPlatform = 'pc' | 'console';

export type ValorantErrorCode =
  | 'config'
  | 'invalid_target'
  | 'not_found'
  | 'provider_error'
  | 'unsupported_platform'
  | 'unsupported_region';

export class ValorantError extends Error {
  constructor(
    public readonly code: ValorantErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ValorantError';
  }
}

export interface ValorantLinkedAccount {
  discordUserId: string;
  name: string;
  tag: string;
  region: ValorantRegion;
  platform: ValorantPlatform;
  puuid?: string;
  accountLevel?: number;
  cardUrl?: string;
  linkedAt: string;
  updatedAt: string;
}

export interface ValorantLinkStore {
  getLink(discordUserId: string): ValorantLinkedAccount | null;
  getAllLinks(): ValorantLinkedAccount[];
  setLink(link: ValorantLinkedAccount): Promise<void>;
  deleteLink(discordUserId: string): Promise<boolean>;
}

export interface ValorantAbility {
  slot?: string;
  displayName: string;
  description?: string;
  displayIcon?: string;
}

export interface ValorantAgent {
  uuid: string;
  displayName: string;
  description?: string;
  displayIcon?: string;
  fullPortrait?: string;
  role?: {
    displayName: string;
    displayIcon?: string;
  };
  abilities: ValorantAbility[];
}

export interface ValorantMap {
  uuid: string;
  displayName: string;
  coordinates?: string;
  narrativeDescription?: string;
  tacticalDescription?: string;
  displayIcon?: string;
  splash?: string;
  callouts: Array<{
    regionName: string;
    superRegionName?: string;
  }>;
  calloutCount: number;
}

export interface ValorantWeaponDamageRange {
  rangeStartMeters?: number;
  rangeEndMeters?: number;
  headDamage?: number;
  bodyDamage?: number;
  legDamage?: number;
}

export interface ValorantWeapon {
  uuid: string;
  displayName: string;
  category?: string;
  displayIcon?: string;
  cost?: number;
  shopCategory?: string;
  fireRate?: number;
  magazineSize?: number;
  reloadTimeSeconds?: number;
  wallPenetration?: string;
  damageRanges: ValorantWeaponDamageRange[];
}

export interface ValorantAccount {
  puuid?: string;
  region?: string;
  accountLevel?: number;
  name: string;
  tag: string;
  cardUrl?: string;
  title?: string;
  platforms?: string[];
  updatedAt?: string;
}

export interface ValorantMmr {
  accountName: string;
  accountTag: string;
  currentTier: string;
  rr?: number;
  lastChange?: number;
  elo?: number;
  peakTier?: string;
  peakSeason?: string;
  leaderboardRank?: number;
  seasonalWins?: number;
  seasonalGames?: number;
}

export interface ValorantMatchPlayer {
  name: string;
  tag: string;
  team?: string;
  character?: string;
  tier?: string;
  kills?: number;
  deaths?: number;
  assists?: number;
  score?: number;
  headshots?: number;
  bodyshots?: number;
  legshots?: number;
}

export interface ValorantMatchSummary {
  matchId?: string;
  map: string;
  mode: string;
  startedAt?: number;
  roundsPlayed?: number;
  character?: string;
  tier?: string;
  team?: string;
  result?: 'Win' | 'Loss' | 'Draw' | 'Unknown';
  kills?: number;
  deaths?: number;
  assists?: number;
  headshots?: number;
  bodyshots?: number;
  legshots?: number;
}

export interface ValorantMatchDetails {
  matchId?: string;
  map: string;
  mode: string;
  region?: string;
  startedAt?: number;
  roundsPlayed?: number;
  redRounds?: number;
  blueRounds?: number;
  winningTeam?: string;
  players: ValorantMatchPlayer[];
}

export interface ValorantStatsSummary {
  matches: number;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  assists: number;
  headshots: number;
  bodyshots: number;
  legshots: number;
  mostPlayedAgents: Array<{ agent: string; matches: number }>;
}

export interface ValorantLeaderboardEntry {
  discordUserId: string;
  name: string;
  tag: string;
  region: ValorantRegion;
  platform: ValorantPlatform;
  rank: string;
  rr?: number;
  elo?: number;
  kda?: number;
  winrate?: number;
  hsPercent?: number;
  matches?: number;
}

export interface ValorantLeaderboardDisplayName {
  discordUserId: string;
  displayName: string;
}

export interface ValorantTeamBalancePlayer {
  discordUserId: string;
  displayName: string;
  rank: string;
  elo: number;
}

export interface ValorantStaticClient {
  getAgents(): Promise<ValorantAgent[]>;
  getMaps(): Promise<ValorantMap[]>;
  getWeapons(): Promise<ValorantWeapon[]>;
}

export interface ValorantHenrikClient {
  getAccount(input: { name: string; tag: string }): Promise<ValorantAccount>;
  getMmr(input: {
    region: ValorantRegion;
    platform: ValorantPlatform;
    name: string;
    tag: string;
  }): Promise<ValorantMmr>;
  getMatches(input: {
    region: ValorantRegion;
    platform: ValorantPlatform;
    name: string;
    tag: string;
    size: number;
    mode?: string;
  }): Promise<ValorantMatchSummary[]>;
  getMatch(input: {
    region: ValorantRegion;
    matchId: string;
  }): Promise<ValorantMatchDetails>;
}

export interface ValorantResolvedTarget {
  source: 'self' | 'member' | 'manual';
  discordUserId?: string;
  name: string;
  tag: string;
  region: ValorantRegion;
  platform: ValorantPlatform;
}

export interface ValorantService {
  findAgent(name: string): Promise<ValorantAgent>;
  findMap(name: string): Promise<ValorantMap>;
  findWeapon(name: string): Promise<ValorantWeapon>;
  getRandomAgent(role?: string): Promise<ValorantAgent>;
  getRandomComp(): Promise<ValorantAgent[]>;
  getStrat(input: {
    map?: string;
    site?: string;
    tone?: 'serious' | 'silly';
  }): Promise<ValorantBaseCard>;
  listAgentChoices(query: string): Promise<string[]>;
  listMapChoices(query: string): Promise<string[]>;
  listWeaponChoices(query: string): Promise<string[]>;
  linkAccount(input: {
    discordUserId: string;
    name: string;
    tag: string;
    region: ValorantRegion;
    platform: ValorantPlatform;
  }): Promise<ValorantLinkedAccount>;
  unlinkAccount(discordUserId: string): Promise<boolean>;
  getLinkedAccount(discordUserId: string): ValorantLinkedAccount | null;
  getAccountCard(input: ValorantTargetRequest): Promise<ValorantAccountCard>;
  getRankCard(input: ValorantTargetRequest): Promise<ValorantRankCard>;
  getMatchesCard(
    input: ValorantTargetRequest & { size?: number; mode?: string },
  ): Promise<ValorantMatchesCard>;
  getMatchCard(input: {
    region: ValorantRegion;
    matchId: string;
  }): Promise<ValorantMatchCard>;
  getStatsCard(
    input: ValorantTargetRequest & { size?: number; mode?: string },
  ): Promise<ValorantStatsCard>;
  getLeaderboardCard(input: {
    sortBy?: 'rank' | 'kda' | 'winrate' | 'hs';
    size?: number;
    mode?: string;
    discordUserIds?: string[];
    displayNames?: ValorantLeaderboardDisplayName[];
  }): Promise<ValorantLeaderboardCard>;
  getTeamBalanceCard(input: {
    players: Array<{ discordUserId: string; displayName: string }>;
  }): Promise<ValorantTeamBalanceCard>;
}

export interface ValorantTargetRequest {
  requesterId: string;
  memberId?: string;
  name?: string;
  tag?: string;
  region?: ValorantRegion;
  platform?: ValorantPlatform;
}

export interface ValorantField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface ValorantBaseCard {
  title: string;
  description: string;
  color: number;
  fields: ValorantField[];
  thumbnailUrl?: string;
  imageUrl?: string;
  footer: string;
}

export type ValorantAccountCard = ValorantBaseCard;
export type ValorantRankCard = ValorantBaseCard;
export type ValorantMatchesCard = ValorantBaseCard;
export type ValorantMatchCard = ValorantBaseCard;
export type ValorantStatsCard = ValorantBaseCard;
export type ValorantLeaderboardCard = ValorantBaseCard;
export type ValorantTeamBalanceCard = ValorantBaseCard;

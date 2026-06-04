export type ApexAppPlatform = 'pc' | 'playstation' | 'xbox';
export type ApexProviderPlatform = 'origin' | 'psn' | 'xbl';
export type ApexStatsProvider = 'tracker' | 'mozambique';

export type ApexErrorCode =
  | 'config'
  | 'invalid_target'
  | 'legend_not_found'
  | 'missing_link'
  | 'not_found'
  | 'provider_error'
  | 'unsupported_platform';

export class ApexError extends Error {
  constructor(
    public readonly code: ApexErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ApexError';
  }
}

export interface ApexLookupInput {
  appPlatform: ApexAppPlatform;
  username?: string;
  uid?: string;
}

export interface ApexLinkedAccount {
  discordUserId: string;
  appPlatform: ApexAppPlatform;
  providerPlatform: ApexProviderPlatform;
  username: string;
  uid?: string;
  displayName: string;
  linkedAt: string;
  updatedAt: string;
}

export interface ApexLinkStore {
  getLink(discordUserId: string): ApexLinkedAccount | null;
  setLink(link: ApexLinkedAccount): Promise<void>;
  deleteLink(discordUserId: string): Promise<boolean>;
}

export interface ApexProfileStat {
  rank?: number | null;
  percentile?: number | null;
  displayName?: string;
  displayCategory?: string | null;
  category?: string | null;
  metadata?: Record<string, unknown>;
  value?: number | null;
  displayValue?: string;
  displayType?: string;
}

export interface ApexProfileSegment {
  type: string;
  attributes?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  stats?: Record<string, ApexProfileStat>;
  expiryDate?: string;
}

export interface ApexProfile {
  platformInfo: {
    platformSlug?: string;
    platformUserHandle?: string;
    platformUserIdentifier?: string;
    avatarUrl?: string;
  };
  userInfo?: Record<string, unknown>;
  metadata: {
    activeLegend?: string;
    activeLegendName?: string;
  };
  segments: ApexProfileSegment[];
  availableSegments?: Array<{
    type: string;
    attributes?: Record<string, unknown>;
  }>;
  providerName?: string;
}

export interface ApexApiClient {
  getProfile(input: ApexLookupInput): Promise<ApexProfile>;
  getMapRotation?(): Promise<ApexMapRotation>;
}

export type ApexLookupSource = 'manual' | 'member' | 'self';

export interface ApexResolvedTarget {
  source: ApexLookupSource;
  discordUserId?: string;
  appPlatform: ApexAppPlatform;
  providerPlatform: ApexProviderPlatform;
  username: string;
  uid?: string;
  displayName: string;
}

export interface ApexEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface ApexOverviewCard {
  target: ApexResolvedTarget;
  title: string;
  description: string;
  url: string;
  thumbnailUrl?: string;
  color: number;
  fields: ApexEmbedField[];
  footer: string;
}

export interface ApexLegendCard {
  target: ApexResolvedTarget;
  title: string;
  description: string;
  url: string;
  thumbnailUrl?: string;
  color: number;
  fields: ApexEmbedField[];
  footer: string;
  legendName: string;
}

export interface ApexRankCard {
  target: ApexResolvedTarget;
  title: string;
  description: string;
  url: string;
  thumbnailUrl?: string;
  color: number;
  fields: ApexEmbedField[];
  footer: string;
}

export interface ApexCompareCard {
  title: string;
  description: string;
  color: number;
  fields: ApexEmbedField[];
  footer: string;
}

export interface ApexSquadCard {
  title: string;
  description: string;
  color: number;
  fields: ApexEmbedField[];
  footer: string;
}

export interface ApexWatchCard {
  title: string;
  description: string;
  color: number;
  fields: ApexEmbedField[];
  footer: string;
}

export interface ApexMapRotation {
  current: {
    map: string;
    mode?: string;
    remainingSeconds?: number;
    endsAt?: string;
  };
  next?: {
    map: string;
    mode?: string;
    startsAt?: string;
  };
  source: string;
}

export interface ApexLegendRequest {
  requesterId: string;
  legend: string;
  memberId?: string;
  appPlatform?: ApexAppPlatform;
  username?: string;
  uid?: string;
}

export interface ApexService {
  linkAccount(input: {
    discordUserId: string;
    appPlatform: ApexAppPlatform;
    username?: string;
    uid?: string;
  }): Promise<ApexLinkedAccount>;
  unlinkAccount(discordUserId: string): Promise<boolean>;
  getLinkedAccount(discordUserId: string): ApexLinkedAccount | null;
  getOverviewForSelf(discordUserId: string): Promise<ApexOverviewCard>;
  getOverviewForMember(discordUserId: string): Promise<ApexOverviewCard>;
  getOverviewForLookup(input: ApexLookupInput): Promise<ApexOverviewCard>;
  getLegendForRequest(input: ApexLegendRequest): Promise<ApexLegendCard>;
  getRankForRequest(input: {
    requesterId: string;
    memberId?: string;
  }): Promise<ApexRankCard>;
  compareLinkedAccounts(input: {
    requesterId: string;
    memberId: string;
  }): Promise<ApexCompareCard>;
  getSquadCard(discordUserIds: string[]): Promise<ApexSquadCard>;
  getMapRotation(): Promise<ApexMapRotation>;
  watchAccount(discordUserId: string): Promise<ApexWatchCard>;
}

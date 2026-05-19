import type { Logger } from '../utils/logger';
import { getPlatformLabel, toMozambiquePlatform } from './platform';
import {
  ApexError,
  type ApexApiClient,
  type ApexLookupInput,
  type ApexProfile,
  type ApexProfileSegment,
  type ApexProfileStat,
} from './types';

const MOZAMBIQUE_API_BASE_URL = 'https://api.mozambiquehe.re';
const REQUEST_TIMEOUT_MS = 10_000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const asNumber = (value: unknown): number | null | undefined => {
  if (value === undefined) {
    return undefined;
  }

  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const asStringMap = (value: unknown): Record<string, unknown> =>
  isObject(value) ? value : {};

const createStat = (
  displayName: string,
  value: unknown,
  displayValue?: string,
  metadata?: Record<string, unknown>,
): ApexProfileStat | undefined => {
  const numericValue = asNumber(value);
  const resolvedDisplayValue =
    displayValue ?? (typeof numericValue === 'number' ? String(numericValue) : undefined);

  if (numericValue === undefined && !resolvedDisplayValue) {
    return undefined;
  }

  return {
    displayName,
    displayValue: resolvedDisplayValue,
    value: numericValue,
    metadata,
  };
};

const trackerToStat = (tracker: unknown): ApexProfileStat | undefined => {
  if (!isObject(tracker)) {
    return undefined;
  }

  const displayName =
    asString(tracker.name) ?? asString(tracker.key) ?? asString(tracker.type);

  if (!displayName) {
    return undefined;
  }

  const value = asNumber(tracker.value);

  return {
    displayName,
    displayValue:
      asString(tracker.valueFormatted) ??
      (typeof value === 'number' ? value.toLocaleString('en-US') : undefined),
    value,
    rank: asNumber(asStringMap(tracker.rank).rankPos) ?? asNumber(tracker.rank),
    percentile:
      asNumber(asStringMap(tracker.rank).topPercent) ??
      asNumber(asStringMap(tracker.rankPlatformSpecific).topPercent),
    metadata: {
      key: tracker.key,
      rank: tracker.rank,
      rankPlatformSpecific: tracker.rankPlatformSpecific,
    },
  };
};

const statKeyFromName = (name: string): string =>
  name
    .replace(/^BR\s+/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+(.)/g, (_, character: string) => character.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, '');

const addStat = (
  stats: Record<string, ApexProfileStat>,
  key: string,
  stat?: ApexProfileStat,
): void => {
  if (stat) {
    stats[key] = stat;
  }
};

const getLegendAssets = (legend: Record<string, unknown>): Record<string, unknown> => {
  const assets = asStringMap(legend.ImgAssets);
  return {
    icon: assets.icon,
    banner: assets.banner,
  };
};

const buildOverviewSegment = (
  data: Record<string, unknown>,
): ApexProfileSegment => {
  const global = asStringMap(data.global);
  const rank = asStringMap(data.rank);
  const total = asStringMap(data.total);
  const stats: Record<string, ApexProfileStat> = {};

  addStat(stats, 'level', createStat('Level', global.level));
  addStat(
    stats,
    'rankScore',
    createStat(
      'Rank Score',
      asStringMap(global.rank).rankScore ?? rank.rankScore,
      undefined,
      {
        rankName: asStringMap(global.rank).rankName ?? rank.rankName,
        rankDiv: asStringMap(global.rank).rankDiv ?? rank.rankDiv,
      },
    ),
  );

  addStat(
    stats,
    'arenaScore',
    createStat('Arena Score', asStringMap(global.arena).rankScore, undefined, {
      rankName: asStringMap(global.arena).rankName,
      rankDiv: asStringMap(global.arena).rankDiv,
    }),
  );

  for (const [key, value] of Object.entries(total)) {
    const stat = trackerToStat(value);

    if (stat) {
      stats[key === 'kd' ? 'killsPerMatch' : statKeyFromName(key)] = stat;
    }
  }

  return {
    type: 'overview',
    stats,
  };
};

const buildLegendSegments = (
  data: Record<string, unknown>,
): ApexProfileSegment[] => {
  const legends = asStringMap(data.legends);
  const allLegends = asStringMap(legends.all);
  const selected = asStringMap(legends.selected);
  const selectedLegendName = asString(selected.LegendName);
  const segments: ApexProfileSegment[] = [];

  for (const [legendName, legendValue] of Object.entries(allLegends)) {
    if (!isObject(legendValue)) {
      continue;
    }

    const stats: Record<string, ApexProfileStat> = {};
    const trackerData = Array.isArray(legendValue.data) ? legendValue.data : [];

    for (const tracker of trackerData) {
      const stat = trackerToStat(tracker);

      if (stat) {
        stats[statKeyFromName(stat.displayName ?? 'stat')] = stat;
      }
    }

    const assets = getLegendAssets(legendValue);
    segments.push({
      type: 'legend',
      metadata: {
        name: legendName,
        portraitImageUrl: asString(assets.banner) ?? asString(assets.icon),
        imageUrl: asString(assets.icon),
        isActive: legendName === selectedLegendName,
      },
      stats,
    });
  }

  if (selectedLegendName && !segments.some((segment) => segment.metadata?.name === selectedLegendName)) {
    const stats: Record<string, ApexProfileStat> = {};
    const trackerData = Array.isArray(selected.data) ? selected.data : [];

    for (const tracker of trackerData) {
      const stat = trackerToStat(tracker);

      if (stat) {
        stats[statKeyFromName(stat.displayName ?? 'stat')] = stat;
      }
    }

    segments.push({
      type: 'legend',
      metadata: {
        name: selectedLegendName,
        portraitImageUrl: asString(asStringMap(selected.ImgAssets).banner),
        imageUrl: asString(asStringMap(selected.ImgAssets).icon),
        isActive: true,
      },
      stats,
    });
  }

  return segments;
};

const normalizeMozambiqueProfile = (
  payload: unknown,
  fallbackUsername: string,
): ApexProfile => {
  if (!isObject(payload)) {
    throw new ApexError(
      'provider_error',
      'Apex Legends Status returned an invalid stats payload.',
    );
  }

  const global = asStringMap(payload.global);
  const legends = asStringMap(payload.legends);
  const selected = asStringMap(legends.selected);
  const activeLegendName = asString(selected.LegendName);

  return {
    providerName: 'Apex Legends Status',
    platformInfo: {
      platformSlug: asString(global.platform) ?? 'PC',
      platformUserHandle: asString(global.name) ?? fallbackUsername,
      platformUserIdentifier: asString(global.uid),
      avatarUrl: asString(global.avatar),
    },
    metadata: {
      activeLegendName,
    },
    segments: [buildOverviewSegment(payload), ...buildLegendSegments(payload)],
  };
};

class MozambiqueApexApiClient implements ApexApiClient {
  constructor(
    private readonly apiKey: string,
    private readonly logger: Logger,
  ) {}

  async getProfile(input: ApexLookupInput): Promise<ApexProfile> {
    const username = input.username?.trim();
    const uid = input.uid?.trim();

    if (!username && !uid) {
      throw new ApexError(
        'invalid_target',
        'Provide either an Apex username or Apex UID.',
      );
    }

    const searchParams = new URLSearchParams({
      auth: this.apiKey,
      platform: toMozambiquePlatform(input.appPlatform),
      merge: 'true',
      removeMerged: 'true',
    });

    if (uid) {
      searchParams.set('uid', uid);
    } else if (username) {
      searchParams.set('player', username);
    }

    const payload = await this.requestJson(
      `/bridge?${searchParams.toString()}`,
      getPlatformLabel(input.appPlatform),
    );

    if (!uid && username) {
      return normalizeMozambiqueProfile(payload, username);
    }

    return normalizeMozambiqueProfile(payload, uid ?? 'Unknown');
  }

  private async requestJson(
    path: string,
    platformLabel: string,
  ): Promise<Record<string, unknown>> {
    const response = await fetch(`${MOZAMBIQUE_API_BASE_URL}${path}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.status === 403) {
      throw new ApexError(
        'config',
        'Apex Legends Status rejected the API key. Confirm MOZAMBIQUE_API_KEY is copied correctly.',
      );
    }

    if (response.status === 404) {
      throw new ApexError(
        'not_found',
        'That Apex account could not be found. For PC lookups, use the EA/Origin account name linked to the Apex account, even if you play through Steam.',
      );
    }

    if (response.status === 410) {
      throw new ApexError(
        'unsupported_platform',
        `Apex Legends Status rejected ${platformLabel} lookups.`,
      );
    }

    if (response.status === 429) {
      throw new ApexError(
        'provider_error',
        'Apex Legends Status rate limited this bot. Please wait a few seconds and try again.',
      );
    }

    if (!response.ok) {
      const body = await response.text();
      this.logger.warn(
        `Apex Legends Status API request failed with status ${response.status}.`,
        body,
      );

      throw new ApexError(
        'provider_error',
        'Apex Legends Status could not return Apex stats right now. Please try again later.',
      );
    }

    const payload = (await response.json()) as unknown;

    if (!isObject(payload)) {
      throw new ApexError(
        'provider_error',
        'Apex Legends Status returned an invalid stats payload.',
      );
    }

    if (typeof payload.Error === 'string') {
      const errorCode = Number(payload.Error);
      const message = asString(payload.Message) ?? 'Apex Legends Status returned an error.';

      if (errorCode === 404) {
        throw new ApexError(
          'not_found',
          'That Apex account could not be found. For PC lookups, use the EA/Origin account name linked to the Apex account, even if you play through Steam.',
        );
      }

      if (errorCode === 403) {
        throw new ApexError(
          'config',
          'Apex Legends Status rejected the API key. Confirm MOZAMBIQUE_API_KEY is copied correctly.',
        );
      }

      throw new ApexError('provider_error', message);
    }

    return payload;
  }
}

export const createMozambiqueApexApiClient = (
  apiKey: string,
  logger: Logger,
): ApexApiClient => new MozambiqueApexApiClient(apiKey, logger);

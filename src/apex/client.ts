import type { Logger } from '../utils/logger';
import { toProviderPlatform } from './platform';
import {
  ApexError,
  type ApexApiClient,
  type ApexLookupInput,
  type ApexProfile,
  type ApexProfileSegment,
  type ApexProfileStat,
} from './types';

const TRACKER_API_BASE_URL = 'https://public-api.tracker.gg/v2/apex/standard';
const REQUEST_TIMEOUT_MS = 10_000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toNumberOrNull = (value: unknown): number | null | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  return null;
};

const normalizeStat = (value: unknown): ApexProfileStat | undefined => {
  if (!isObject(value)) {
    return undefined;
  }

  return {
    rank: toNumberOrNull(value.rank),
    percentile: toNumberOrNull(value.percentile),
    displayName:
      typeof value.displayName === 'string' ? value.displayName : undefined,
    displayCategory:
      typeof value.displayCategory === 'string' ||
      value.displayCategory === null
        ? value.displayCategory
        : undefined,
    category:
      typeof value.category === 'string' || value.category === null
        ? value.category
        : undefined,
    metadata: isObject(value.metadata) ? value.metadata : undefined,
    value: toNumberOrNull(value.value),
    displayValue:
      typeof value.displayValue === 'string' ? value.displayValue : undefined,
    displayType:
      typeof value.displayType === 'string' ? value.displayType : undefined,
  };
};

const normalizeSegment = (value: unknown): ApexProfileSegment | undefined => {
  if (!isObject(value) || typeof value.type !== 'string') {
    return undefined;
  }

  const rawStats = isObject(value.stats) ? value.stats : {};
  const stats = Object.entries(rawStats).reduce<
    Record<string, ApexProfileStat>
  >((accumulator, [key, statValue]) => {
    const normalized = normalizeStat(statValue);

    if (normalized) {
      accumulator[key] = normalized;
    }

    return accumulator;
  }, {});

  return {
    type: value.type,
    attributes: isObject(value.attributes) ? value.attributes : undefined,
    metadata: isObject(value.metadata) ? value.metadata : undefined,
    stats,
    expiryDate:
      typeof value.expiryDate === 'string' ? value.expiryDate : undefined,
  };
};

const normalizeProfile = (value: unknown): ApexProfile => {
  if (!isObject(value)) {
    throw new ApexError(
      'provider_error',
      'Tracker returned an invalid Apex payload.',
    );
  }

  const segments = Array.isArray(value.segments)
    ? value.segments
        .map((segment) => normalizeSegment(segment))
        .filter((segment): segment is ApexProfileSegment => Boolean(segment))
    : [];

  if (segments.length === 0) {
    throw new ApexError(
      'provider_error',
      'Tracker did not return any Apex stats for that player.',
    );
  }

  const platformInfo = isObject(value.platformInfo) ? value.platformInfo : {};
  const metadata = isObject(value.metadata) ? value.metadata : {};

  const availableSegments = Array.isArray(value.availableSegments)
    ? value.availableSegments.filter(isObject).map((segment) => ({
        type: typeof segment.type === 'string' ? segment.type : 'unknown',
        attributes: isObject(segment.attributes)
          ? segment.attributes
          : undefined,
      }))
    : undefined;

  return {
    platformInfo: {
      platformSlug:
        typeof platformInfo.platformSlug === 'string'
          ? platformInfo.platformSlug
          : undefined,
      platformUserHandle:
        typeof platformInfo.platformUserHandle === 'string'
          ? platformInfo.platformUserHandle
          : undefined,
      platformUserIdentifier:
        typeof platformInfo.platformUserIdentifier === 'string'
          ? platformInfo.platformUserIdentifier
          : undefined,
      avatarUrl:
        typeof platformInfo.avatarUrl === 'string'
          ? platformInfo.avatarUrl
          : undefined,
    },
    userInfo: isObject(value.userInfo) ? value.userInfo : undefined,
    metadata: {
      activeLegend:
        typeof metadata.activeLegend === 'string'
          ? metadata.activeLegend
          : undefined,
      activeLegendName:
        typeof metadata.activeLegendName === 'string'
          ? metadata.activeLegendName
          : undefined,
    },
    segments,
    availableSegments,
  };
};

class TrackerApexApiClient implements ApexApiClient {
  constructor(
    private readonly apiKey: string,
    private readonly logger: Logger,
  ) {}

  async getProfile(input: ApexLookupInput): Promise<ApexProfile> {
    const providerPlatform = toProviderPlatform(input.appPlatform);
    const username = input.username?.trim();

    if (!username) {
      throw new ApexError('invalid_target', 'Apex usernames cannot be empty.');
    }

    const payload = await this.requestJson(
      `/profile/${providerPlatform}/${encodeURIComponent(username)}`,
    );
    const data = isObject(payload) ? payload.data : undefined;

    return normalizeProfile(data);
  }

  private async requestJson(path: string): Promise<Record<string, unknown>> {
    const response = await fetch(`${TRACKER_API_BASE_URL}${path}`, {
      headers: {
        'TRN-Api-Key': this.apiKey,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.status === 404) {
      throw new ApexError('not_found', 'That Apex account could not be found.');
    }

    if (response.status === 401) {
      throw new ApexError(
        'config',
        'Tracker returned 401 Unauthorized for the Apex API key. Confirm the key is copied correctly and that the Tracker app has been whitelisted for API access.',
      );
    }

    if (response.status === 403) {
      throw new ApexError(
        'config',
        'Tracker returned 403 Forbidden for the Apex API key. Confirm the Tracker app is approved and allowed to use the Apex API endpoint.',
      );
    }

    if (!response.ok) {
      const body = await response.text();
      this.logger.warn(
        `Tracker Apex API request failed with status ${response.status}.`,
        body,
      );

      throw new ApexError(
        'provider_error',
        'Tracker could not return Apex stats right now. Please try again later.',
      );
    }

    const payload = (await response.json()) as unknown;

    if (!isObject(payload)) {
      throw new ApexError(
        'provider_error',
        'Tracker returned an invalid Apex payload.',
      );
    }

    return payload;
  }
}

export const createTrackerApexApiClient = (
  apiKey: string,
  logger: Logger,
): ApexApiClient => new TrackerApexApiClient(apiKey, logger);

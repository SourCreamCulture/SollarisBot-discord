import type { Logger } from '../utils/logger';
import {
  ValorantError,
  type ValorantAgent,
  type ValorantMap,
  type ValorantStaticClient,
  type ValorantWeapon,
  type ValorantWeaponDamageRange,
} from './types';

const VALORANT_API_BASE_URL = 'https://valorant-api.com/v1';
const REQUEST_TIMEOUT_MS = 10_000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toStringOrUndefined = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

const toNumberOrUndefined = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const simplifyCategory = (value: string | undefined): string | undefined =>
  value?.split('::').at(-1);

const normalizeAgent = (value: unknown): ValorantAgent | undefined => {
  if (!isObject(value) || typeof value.uuid !== 'string') {
    return undefined;
  }

  const displayName = toStringOrUndefined(value.displayName);

  if (!displayName || value.isPlayableCharacter === false) {
    return undefined;
  }

  const role = isObject(value.role)
    ? {
        displayName: toStringOrUndefined(value.role.displayName) ?? 'Unknown',
        displayIcon: toStringOrUndefined(value.role.displayIcon),
      }
    : undefined;

  const abilities = Array.isArray(value.abilities)
    ? value.abilities
        .filter(isObject)
        .map((ability) => ({
          slot: toStringOrUndefined(ability.slot),
          displayName:
            toStringOrUndefined(ability.displayName) ?? 'Unknown Ability',
          description: toStringOrUndefined(ability.description),
          displayIcon: toStringOrUndefined(ability.displayIcon),
        }))
        .filter((ability) => ability.displayName !== 'Unknown Ability')
    : [];

  return {
    uuid: value.uuid,
    displayName,
    description: toStringOrUndefined(value.description),
    displayIcon: toStringOrUndefined(value.displayIcon),
    fullPortrait: toStringOrUndefined(value.fullPortrait),
    role,
    abilities,
  };
};

const normalizeMap = (value: unknown): ValorantMap | undefined => {
  if (!isObject(value) || typeof value.uuid !== 'string') {
    return undefined;
  }

  const displayName = toStringOrUndefined(value.displayName);

  if (!displayName) {
    return undefined;
  }

  return {
    uuid: value.uuid,
    displayName,
    coordinates: toStringOrUndefined(value.coordinates),
    narrativeDescription: toStringOrUndefined(value.narrativeDescription),
    tacticalDescription: toStringOrUndefined(value.tacticalDescription),
    displayIcon: toStringOrUndefined(value.displayIcon),
    splash: toStringOrUndefined(value.splash),
    callouts: Array.isArray(value.callouts)
      ? value.callouts.filter(isObject).map((callout) => ({
          regionName: toStringOrUndefined(callout.regionName) ?? 'Unknown',
          superRegionName: toStringOrUndefined(callout.superRegionName),
        }))
      : [],
    calloutCount: Array.isArray(value.callouts) ? value.callouts.length : 0,
  };
};

const normalizeDamageRange = (
  value: unknown,
): ValorantWeaponDamageRange | undefined => {
  if (!isObject(value)) {
    return undefined;
  }

  return {
    rangeStartMeters: toNumberOrUndefined(value.rangeStartMeters),
    rangeEndMeters: toNumberOrUndefined(value.rangeEndMeters),
    headDamage: toNumberOrUndefined(value.headDamage),
    bodyDamage: toNumberOrUndefined(value.bodyDamage),
    legDamage: toNumberOrUndefined(value.legDamage),
  };
};

const normalizeWeapon = (value: unknown): ValorantWeapon | undefined => {
  if (!isObject(value) || typeof value.uuid !== 'string') {
    return undefined;
  }

  const displayName = toStringOrUndefined(value.displayName);

  if (!displayName) {
    return undefined;
  }

  const shopData = isObject(value.shopData) ? value.shopData : {};
  const weaponStats = isObject(value.weaponStats) ? value.weaponStats : {};

  return {
    uuid: value.uuid,
    displayName,
    category: simplifyCategory(toStringOrUndefined(value.category)),
    displayIcon: toStringOrUndefined(value.displayIcon),
    cost: toNumberOrUndefined(shopData.cost),
    shopCategory: toStringOrUndefined(shopData.categoryText),
    fireRate: toNumberOrUndefined(weaponStats.fireRate),
    magazineSize: toNumberOrUndefined(weaponStats.magazineSize),
    reloadTimeSeconds: toNumberOrUndefined(weaponStats.reloadTimeSeconds),
    wallPenetration: simplifyCategory(
      toStringOrUndefined(weaponStats.wallPenetration),
    ),
    damageRanges: Array.isArray(weaponStats.damageRanges)
      ? weaponStats.damageRanges
          .map((range) => normalizeDamageRange(range))
          .filter((range): range is ValorantWeaponDamageRange => Boolean(range))
      : [],
  };
};

class DefaultValorantStaticClient implements ValorantStaticClient {
  private agentsCache?: Promise<ValorantAgent[]>;
  private mapsCache?: Promise<ValorantMap[]>;
  private weaponsCache?: Promise<ValorantWeapon[]>;

  constructor(private readonly logger: Logger) {}

  getAgents(): Promise<ValorantAgent[]> {
    this.agentsCache ??= this.requestCollection('/agents', normalizeAgent);
    return this.agentsCache;
  }

  getMaps(): Promise<ValorantMap[]> {
    this.mapsCache ??= this.requestCollection('/maps', normalizeMap);
    return this.mapsCache;
  }

  getWeapons(): Promise<ValorantWeapon[]> {
    this.weaponsCache ??= this.requestCollection('/weapons', normalizeWeapon);
    return this.weaponsCache;
  }

  private async requestCollection<T>(
    path: string,
    normalize: (value: unknown) => T | undefined,
  ): Promise<T[]> {
    const response = await fetch(`${VALORANT_API_BASE_URL}${path}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.warn(
        `Valorant-API request failed with status ${response.status}.`,
        body,
      );

      throw new ValorantError(
        'provider_error',
        'Valorant game data is not available right now. Please try again later.',
      );
    }

    const payload = (await response.json()) as unknown;
    const data = isObject(payload) ? payload.data : undefined;

    if (!Array.isArray(data)) {
      throw new ValorantError(
        'provider_error',
        'Valorant-API returned an invalid payload.',
      );
    }

    return data
      .map((item) => normalize(item))
      .filter((item): item is T => Boolean(item));
  }
}

export const createValorantStaticClient = (
  logger: Logger,
): ValorantStaticClient => new DefaultValorantStaticClient(logger);

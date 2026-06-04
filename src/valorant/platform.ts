import {
  ValorantError,
  type ValorantPlatform,
  type ValorantRegion,
} from './types';

export const DEFAULT_VALORANT_LINKS_FILE = 'data/valorant-links.json';

export const VALORANT_REGION_CHOICES = [
  { name: 'North America', value: 'na' },
  { name: 'Europe', value: 'eu' },
  { name: 'Asia-Pacific', value: 'ap' },
  { name: 'Korea', value: 'kr' },
  { name: 'Latin America', value: 'latam' },
  { name: 'Brazil', value: 'br' },
] as const satisfies ReadonlyArray<{ name: string; value: ValorantRegion }>;

export const VALORANT_PLATFORM_CHOICES = [
  { name: 'PC', value: 'pc' },
  { name: 'Console', value: 'console' },
] as const satisfies ReadonlyArray<{ name: string; value: ValorantPlatform }>;

export const VALORANT_MODE_CHOICES = [
  { name: 'Competitive', value: 'competitive' },
  { name: 'Unrated', value: 'unrated' },
  { name: 'Swiftplay', value: 'swiftplay' },
  { name: 'Spike Rush', value: 'spikerush' },
  { name: 'Deathmatch', value: 'deathmatch' },
  { name: 'Team Deathmatch', value: 'teamdeathmatch' },
] as const;

const SUPPORTED_REGIONS = new Set<string>(
  VALORANT_REGION_CHOICES.map((choice) => choice.value),
);

const SUPPORTED_PLATFORMS = new Set<string>(
  VALORANT_PLATFORM_CHOICES.map((choice) => choice.value),
);

export const assertValorantRegion = (value: string): ValorantRegion => {
  if (SUPPORTED_REGIONS.has(value)) {
    return value as ValorantRegion;
  }

  throw new ValorantError(
    'unsupported_region',
    'Supported Valorant regions are NA, EU, AP, KR, LATAM, and BR.',
  );
};

export const assertValorantPlatform = (value: string): ValorantPlatform => {
  if (SUPPORTED_PLATFORMS.has(value)) {
    return value as ValorantPlatform;
  }

  throw new ValorantError(
    'unsupported_platform',
    'Supported Valorant platforms are PC and Console.',
  );
};

export const getValorantRegionLabel = (region: ValorantRegion): string => {
  switch (region) {
    case 'na':
      return 'North America';
    case 'eu':
      return 'Europe';
    case 'ap':
      return 'Asia-Pacific';
    case 'kr':
      return 'Korea';
    case 'latam':
      return 'Latin America';
    case 'br':
      return 'Brazil';
  }
};

export const getValorantPlatformLabel = (
  platform: ValorantPlatform,
): string => {
  switch (platform) {
    case 'pc':
      return 'PC';
    case 'console':
      return 'Console';
  }
};

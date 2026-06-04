import {
  ApexError,
  type ApexAppPlatform,
  type ApexProviderPlatform,
} from './types';

export const DEFAULT_APEX_LINKS_FILE = 'data/apex-links.json';

export const APEX_PLATFORM_CHOICES = [
  {
    name: 'PC',
    value: 'pc',
  },
  {
    name: 'PlayStation',
    value: 'playstation',
  },
  {
    name: 'Xbox',
    value: 'xbox',
  },
] as const satisfies ReadonlyArray<{
  name: string;
  value: ApexAppPlatform;
}>;

const SUPPORTED_PLATFORMS = new Set<string>(
  APEX_PLATFORM_CHOICES.map((choice) => choice.value),
);

export const assertSupportedApexPlatform = (value: string): ApexAppPlatform => {
  if (SUPPORTED_PLATFORMS.has(value)) {
    return value as ApexAppPlatform;
  }

  throw new ApexError(
    'unsupported_platform',
    'Supported Apex platforms are PC, PlayStation, and Xbox.',
  );
};

export const getPlatformLabel = (platform: ApexAppPlatform): string => {
  switch (platform) {
    case 'pc':
      return 'PC';
    case 'playstation':
      return 'PlayStation';
    case 'xbox':
      return 'Xbox';
  }
};

export const toProviderPlatform = (
  platform: ApexAppPlatform,
): ApexProviderPlatform => {
  switch (platform) {
    case 'pc':
      return 'origin';
    case 'playstation':
      return 'psn';
    case 'xbox':
      return 'xbl';
  }
};

export const toMozambiquePlatform = (platform: ApexAppPlatform): string => {
  switch (platform) {
    case 'pc':
      return 'PC';
    case 'playstation':
      return 'PS4';
    case 'xbox':
      return 'X1';
  }
};

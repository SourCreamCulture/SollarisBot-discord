import { getPlatformLabel } from './platform';
import {
  ApexError,
  type ApexLegendCard,
  type ApexOverviewCard,
  type ApexProfile,
  type ApexProfileSegment,
  type ApexProfileStat,
  type ApexResolvedTarget,
} from './types';

const DEFAULT_EMBED_COLOR = 0xda292a;
const CURRENT_APEX_SEASON = 28;

const numberFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
});

const normalizeText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]/g, '');

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const parseColor = (value: unknown): number | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.startsWith('#') ? value.slice(1) : value;

  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return undefined;
  }

  return Number.parseInt(normalized, 16);
};

const formatNumericValue = (value: number): string =>
  Number.isInteger(value)
    ? numberFormatter.format(value)
    : numberFormatter.format(value);

const formatStatValue = (stat?: ApexProfileStat): string => {
  if (!stat) {
    return 'N/A';
  }

  if (stat.displayValue) {
    return stat.displayValue;
  }

  if (typeof stat.value === 'number') {
    return formatNumericValue(stat.value);
  }

  return 'N/A';
};

const formatRankValue = (stat?: ApexProfileStat): string => {
  if (!stat) {
    return 'Unranked';
  }

  const metadata = stat.metadata ?? {};
  const rankName = asString(metadata.rankName);
  const pieces = [rankName, formatStatValue(stat)].filter(Boolean);
  const details: string[] = [];

  if (typeof stat.rank === 'number' && stat.rank > 0) {
    details.push(`#${formatNumericValue(stat.rank)}`);
  }

  if (typeof stat.percentile === 'number') {
    details.push(`Percentile ${numberFormatter.format(stat.percentile)}`);
  }

  const detailText = details.length > 0 ? ` (${details.join(' • ')})` : '';

  return `${pieces.join(' • ')}${detailText}`.trim();
};

const getStatSourceLabel = (
  label: string,
  stat?: ApexProfileStat,
): string | undefined => {
  if (!stat?.displayName) {
    return undefined;
  }

  return normalizeText(stat.displayName) === normalizeText(label)
    ? undefined
    : stat.displayName;
};

const getSeasonNumber = (stat?: ApexProfileStat): number | undefined => {
  const source = `${stat?.displayName ?? ''} ${asString(stat?.metadata?.key) ?? ''}`;
  const match = /\bseason\s*(\d+)\b|season_(\d+)\b/i.exec(source);
  const rawSeason = match?.[1] ?? match?.[2];

  if (!rawSeason) {
    return undefined;
  }

  const parsed = Number.parseInt(rawSeason, 10);

  return Number.isFinite(parsed) ? parsed : undefined;
};

const isStaleSeasonStat = (stat?: ApexProfileStat): boolean => {
  const season = getSeasonNumber(stat);
  return typeof season === 'number' && season !== CURRENT_APEX_SEASON;
};

const formatStatLine = (
  label: string,
  stat?: ApexProfileStat,
): string | undefined => {
  if (!stat) {
    return undefined;
  }

  const source = getStatSourceLabel(label, stat);
  return source
    ? `${label}: **${formatStatValue(stat)}** (${source})`
    : `${label}: **${formatStatValue(stat)}**`;
};

const hasExplicitPeakRank = (stat?: ApexProfileStat): boolean =>
  Boolean(stat && stat.displayName && /peak/i.test(stat.displayName));

const getProfileUrl = (target: ApexResolvedTarget): string =>
  `https://apex.tracker.gg/apex/profile/${target.providerPlatform}/${encodeURIComponent(
    target.username,
  )}/overview`;

const getProviderName = (profile: ApexProfile): string =>
  profile.providerName ?? 'Tracker Network';

const getOverviewSegment = (profile: ApexProfile): ApexProfileSegment => {
  const overviewSegment =
    profile.segments.find((segment) => segment.type === 'overview') ??
    profile.segments[0];

  if (!overviewSegment) {
    throw new ApexError(
      'provider_error',
      'Tracker did not return an overview segment for this Apex player.',
    );
  }

  return overviewSegment;
};

const getActiveLegendSegment = (
  profile: ApexProfile,
): ApexProfileSegment | undefined => {
  const activeLegendName = profile.metadata.activeLegendName;

  if (activeLegendName) {
    return profile.segments.find(
      (segment) =>
        segment.type === 'legend' &&
        normalizeText(asString(segment.metadata?.name) ?? '') ===
          normalizeText(activeLegendName),
    );
  }

  return profile.segments.find(
    (segment) =>
      segment.type === 'legend' && segment.metadata?.isActive === true,
  );
};

const findStat = (
  stats: Record<string, ApexProfileStat>,
  options: {
    keys?: string[];
    displayNames?: string[];
  },
): ApexProfileStat | undefined => {
  for (const key of options.keys ?? []) {
    if (stats[key]) {
      return stats[key];
    }
  }

  for (const displayName of options.displayNames ?? []) {
    const normalizedName = normalizeText(displayName);
    const matched = Object.values(stats).find(
      (stat) =>
        normalizeText(stat.displayName ?? '') === normalizedName ||
        normalizeText(stat.displayName ?? '').endsWith(normalizedName),
    );

    if (matched) {
      return matched;
    }
  }

  return undefined;
};

const getPlayerDisplayName = (profile: ApexProfile, fallback: string): string =>
  profile.platformInfo.platformUserHandle ??
  profile.platformInfo.platformUserIdentifier ??
  fallback;

const getOverviewStatBlock = (
  profile: ApexProfile,
): {
  level?: ApexProfileStat;
  kills?: ApexProfileStat;
  damage?: ApexProfileStat;
  matches?: ApexProfileStat;
  wins?: ApexProfileStat;
  killsPerMatch?: ApexProfileStat;
  damagePerMatch?: ApexProfileStat;
  rankScore?: ApexProfileStat;
  peakRank?: ApexProfileStat;
} => {
  const stats = getOverviewSegment(profile).stats ?? {};
  const findStatByKeyFragment = (
    fragment: string,
  ): ApexProfileStat | undefined =>
    Object.entries(stats)
      .filter(
        ([key, stat]) =>
          key.toLowerCase().includes(fragment) && !isStaleSeasonStat(stat),
      )
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, stat]) => stat)
      .find(Boolean);
  const findRelevantStat = (
    options: Parameters<typeof findStat>[1],
  ): ApexProfileStat | undefined => {
    const stat = findStat(stats, options);
    return isStaleSeasonStat(stat) ? undefined : stat;
  };

  return {
    level: findRelevantStat({ keys: ['level'], displayNames: ['Level'] }),
    damage: findRelevantStat({ keys: ['damage'], displayNames: ['Damage'] }),
    matches: findRelevantStat({
      keys: ['matchesPlayed', 'matches'],
      displayNames: ['Matches Played', 'Matches'],
    }),
    kills:
      findRelevantStat({ keys: ['kills'], displayNames: ['Kills'] }) ??
      findStatByKeyFragment('kills'),
    wins:
      findRelevantStat({ keys: ['wins'], displayNames: ['Wins'] }) ??
      findStatByKeyFragment('wins'),
    killsPerMatch: findRelevantStat({
      keys: ['killsPerMatch'],
      displayNames: ['Kills Per Match'],
    }),
    damagePerMatch: findRelevantStat({
      keys: ['damagePerMatch'],
      displayNames: ['Damage Per Match'],
    }),
    rankScore: findRelevantStat({
      keys: ['rankScore'],
      displayNames: ['Rank Score'],
    }),
    peakRank: findRelevantStat({
      keys: ['lifetimePeakRankScore'],
      displayNames: ['Lifetime Peak Rank Score'],
    }),
  };
};

const selectLegendStats = (
  legendSegment: ApexProfileSegment,
): ApexProfileStat[] => {
  const stats = legendSegment.stats ?? {};
  const preferredKeys = [
    'kills',
    'wins',
    'damage',
    'matchesPlayed',
    'headshots',
    'killsAsKillLeader',
    'seasonWins',
    'seasonKills',
    'seasonDamage',
    'carePackageKills',
    'finishers',
    'revives',
  ];

  const selected: ApexProfileStat[] = [];
  const seen = new Set<string>();

  for (const key of preferredKeys) {
    if (stats[key]) {
      selected.push(stats[key]);
      seen.add(key);
    }
  }

  const remaining = Object.entries(stats)
    .filter(([key]) => !seen.has(key))
    .map(([, stat]) => stat)
    .sort((left, right) =>
      (left.displayName ?? '').localeCompare(right.displayName ?? ''),
    );

  return [...selected, ...remaining].slice(0, 8);
};

export const buildOverviewCard = (
  profile: ApexProfile,
  target: ApexResolvedTarget,
): ApexOverviewCard => {
  const displayName = getPlayerDisplayName(profile, target.displayName);
  const activeLegend = getActiveLegendSegment(profile);
  const overview = getOverviewStatBlock(profile);
  const thumbnailUrl =
    profile.platformInfo.avatarUrl ??
    asString(activeLegend?.metadata?.portraitImageUrl) ??
    asString(activeLegend?.metadata?.imageUrl);

  const color =
    parseColor(activeLegend?.metadata?.legendColor) ?? DEFAULT_EMBED_COLOR;
  const sourceLabel =
    target.source === 'self'
      ? 'your linked Apex account'
      : target.source === 'member'
        ? 'a linked Discord member'
        : 'a manual Apex lookup';
  const trackerEntries = [
    { label: 'Kills', stat: overview.kills },
    { label: 'Damage', stat: overview.damage },
    { label: 'Wins', stat: overview.wins },
    { label: 'Matches', stat: overview.matches },
    { label: 'Kills / Match', stat: overview.killsPerMatch },
    { label: 'Damage / Match', stat: overview.damagePerMatch },
  ];
  const currentSeasonLines = trackerEntries
    .filter(({ stat }) => getSeasonNumber(stat) === CURRENT_APEX_SEASON)
    .map(({ label, stat }) => formatStatLine(label, stat))
    .filter((line): line is string => Boolean(line));
  const nonSeasonTrackerLines = trackerEntries
    .filter(({ stat }) => !stat || typeof getSeasonNumber(stat) === 'undefined')
    .map(({ label, stat }) => formatStatLine(label, stat))
    .filter((line): line is string => Boolean(line));
  const reliableLines = [
    formatStatLine('Level', overview.level),
    overview.rankScore
      ? `Current Rank: **${formatRankValue(overview.rankScore)}**`
      : undefined,
  ].filter((line): line is string => Boolean(line));

  const fields = [
    {
      name: 'Account',
      value: [
        `Display Name: **${displayName}**`,
        `Username: \`${target.username}\``,
        `Platform: **${getPlatformLabel(target.appPlatform)}**`,
        `Active Legend: **${profile.metadata.activeLegendName ?? 'Unknown'}**`,
      ].join('\n'),
      inline: true,
    },
    {
      name: 'Reliable Stats',
      value:
        reliableLines.length > 0
          ? reliableLines.join('\n')
          : 'No reliable account snapshot stats were returned for this account.',
      inline: true,
    },
  ];

  if (currentSeasonLines.length > 0) {
    fields.push({
      name: `Current Season ${CURRENT_APEX_SEASON}`,
      value: currentSeasonLines.join('\n'),
      inline: false,
    });
  }

  if (nonSeasonTrackerLines.length > 0) {
    fields.push({
      name: 'Other Public Trackers',
      value: nonSeasonTrackerLines.join('\n'),
      inline: false,
    });
  }

  if (hasExplicitPeakRank(overview.peakRank)) {
    fields.push({
      name: 'Lifetime / Peak',
      value: `Peak Rank: **${formatRankValue(overview.peakRank)}**`,
      inline: false,
    });
  }

  fields.push({
    name: 'Data Note',
    value: `Apex does not expose complete career stats through this provider. This view only highlights reliable account snapshot values plus current-season or unscoped public trackers returned by the API.`,
    inline: false,
  });

  return {
    target: {
      ...target,
      displayName,
    },
    title: `Apex Stats: ${displayName}`,
    description: `Overview for ${sourceLabel}. Values shown are reliable snapshot stats and clearly labeled provider-returned trackers, not assumed all-time career totals.`,
    url: getProfileUrl(target),
    thumbnailUrl,
    color,
    fields,
    footer: `${getProviderName(profile)} • ${getPlatformLabel(target.appPlatform)}`,
  };
};

export const buildLegendCard = (
  profile: ApexProfile,
  target: ApexResolvedTarget,
  legendQuery: string,
): ApexLegendCard => {
  const legendSegment = profile.segments.find(
    (segment) =>
      segment.type === 'legend' &&
      normalizeText(asString(segment.metadata?.name) ?? '') ===
        normalizeText(legendQuery),
  );

  if (!legendSegment) {
    throw new ApexError(
      'legend_not_found',
      `I couldn't find legend stats for "${legendQuery}".`,
    );
  }

  const legendName = asString(legendSegment.metadata?.name) ?? legendQuery;
  const legendStats = selectLegendStats(legendSegment);
  const displayName = getPlayerDisplayName(profile, target.displayName);
  const statLines =
    legendStats.length > 0
      ? legendStats.map(
          (stat) =>
            `${stat.displayName ?? 'Stat'}: **${formatStatValue(stat)}**`,
        )
      : ['No legend-specific stats were returned for this player.'];

  return {
    target: {
      ...target,
      displayName,
    },
    title: `${legendName} Stats: ${displayName}`,
    description: `${legendName} performance on ${getPlatformLabel(target.appPlatform)}.`,
    url: getProfileUrl(target),
    thumbnailUrl:
      asString(legendSegment.metadata?.portraitImageUrl) ??
      asString(legendSegment.metadata?.imageUrl) ??
      profile.platformInfo.avatarUrl,
    color:
      parseColor(legendSegment.metadata?.legendColor) ?? DEFAULT_EMBED_COLOR,
    fields: [
      {
        name: 'Lookup',
        value: [
          `Player: **${displayName}**`,
          `Username: \`${target.username}\``,
          `Legend: **${legendName}**`,
        ].join('\n'),
        inline: true,
      },
      {
        name: 'Legend Highlights',
        value: statLines.join('\n'),
        inline: false,
      },
    ],
    footer: `${getProviderName(profile)} • ${getPlatformLabel(target.appPlatform)}`,
    legendName,
  };
};

export const resolveProfileDisplayName = (
  profile: ApexProfile,
  fallback: string,
): string => getPlayerDisplayName(profile, fallback);

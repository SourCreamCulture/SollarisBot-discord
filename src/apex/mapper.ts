import { getPlatformLabel } from './platform';
import {
  ApexError,
  type ApexCompareCard,
  type ApexLegendCard,
  type ApexOverviewCard,
  type ApexProfile,
  type ApexProfileSegment,
  type ApexProfileStat,
  type ApexRankCard,
  type ApexResolvedTarget,
  type ApexSquadCard,
  type ApexWatchCard,
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

const getNumericStatValue = (stat?: ApexProfileStat): number | undefined =>
  typeof stat?.value === 'number' ? stat.value : undefined;

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

export const buildRankCard = (
  profile: ApexProfile,
  target: ApexResolvedTarget,
): ApexRankCard => {
  const displayName = getPlayerDisplayName(profile, target.displayName);
  const overview = getOverviewStatBlock(profile);

  return {
    target: {
      ...target,
      displayName,
    },
    title: `Apex Rank: ${displayName}`,
    description: `Rank snapshot for ${getPlatformLabel(target.appPlatform)}.`,
    url: getProfileUrl(target),
    thumbnailUrl: profile.platformInfo.avatarUrl,
    color: DEFAULT_EMBED_COLOR,
    fields: [
      {
        name: 'Current Rank',
        value: overview.rankScore
          ? formatRankValue(overview.rankScore)
          : 'Unranked or unavailable',
        inline: false,
      },
      {
        name: 'Progress',
        value:
          [
            formatStatLine('Level', overview.level),
            overview.peakRank
              ? `Peak Rank: **${formatRankValue(overview.peakRank)}**`
              : undefined,
          ]
            .filter((line): line is string => Boolean(line))
            .join('\n') || 'No extra ranked progression values were returned.',
        inline: false,
      },
    ],
    footer: `${getProviderName(profile)} • ${getPlatformLabel(target.appPlatform)}`,
  };
};

export const buildCompareCard = (
  leftProfile: ApexProfile,
  leftTarget: ApexResolvedTarget,
  rightProfile: ApexProfile,
  rightTarget: ApexResolvedTarget,
): ApexCompareCard => {
  const leftName = getPlayerDisplayName(leftProfile, leftTarget.displayName);
  const rightName = getPlayerDisplayName(rightProfile, rightTarget.displayName);
  const left = getOverviewStatBlock(leftProfile);
  const right = getOverviewStatBlock(rightProfile);
  const rows = [
    ['Level', left.level, right.level],
    ['Rank Score', left.rankScore, right.rankScore],
    ['Kills', left.kills, right.kills],
    ['Wins', left.wins, right.wins],
    ['Damage', left.damage, right.damage],
    ['Matches', left.matches, right.matches],
  ];

  return {
    title: `Apex Compare: ${leftName} vs ${rightName}`,
    description:
      'Side-by-side comparison using the reliable public stats returned by the active provider.',
    color: DEFAULT_EMBED_COLOR,
    fields: rows.map(([label, leftStat, rightStat]) => ({
      name: label as string,
      value: `**${leftName}:** ${formatStatValue(
        leftStat as ApexProfileStat | undefined,
      )}\n**${rightName}:** ${formatStatValue(
        rightStat as ApexProfileStat | undefined,
      )}`,
      inline: true,
    })),
    footer: `${getProviderName(leftProfile)} • ${getPlatformLabel(leftTarget.appPlatform)}`,
  };
};

export const buildSquadCard = (
  entries: Array<{ profile: ApexProfile; target: ApexResolvedTarget }>,
): ApexSquadCard => ({
  title: 'Apex Squad',
  description: 'Linked squad snapshot for this server.',
  color: DEFAULT_EMBED_COLOR,
  fields: entries.map(({ profile, target }) => {
    const overview = getOverviewStatBlock(profile);
    const displayName = getPlayerDisplayName(profile, target.displayName);

    return {
      name: displayName,
      value: [
        `Rank: **${
          overview.rankScore ? formatRankValue(overview.rankScore) : 'N/A'
        }**`,
        `Level: **${formatStatValue(overview.level)}**`,
        `Kills: **${formatStatValue(overview.kills)}**`,
        `Wins: **${formatStatValue(overview.wins)}**`,
      ].join('\n'),
      inline: true,
    };
  }),
  footer:
    entries.length > 0
      ? `${getProviderName(entries[0].profile)} • ${entries.length} member(s)`
      : 'No linked members',
});

export const extractWatchStats = (
  profile: ApexProfile,
): Record<string, number> => {
  const overview = getOverviewStatBlock(profile);
  const entries = {
    level: getNumericStatValue(overview.level),
    rankScore: getNumericStatValue(overview.rankScore),
    kills: getNumericStatValue(overview.kills),
    wins: getNumericStatValue(overview.wins),
    damage: getNumericStatValue(overview.damage),
    matches: getNumericStatValue(overview.matches),
  };

  return Object.fromEntries(
    Object.entries(entries).filter(
      (entry): entry is [string, number] => typeof entry[1] === 'number',
    ),
  );
};

export const buildWatchCard = (
  target: ApexResolvedTarget,
  previousStats: Record<string, number> | null,
  currentStats: Record<string, number>,
  previousCapturedAt?: string,
): ApexWatchCard => {
  const labels: Record<string, string> = {
    level: 'Level',
    rankScore: 'Rank Score',
    kills: 'Kills',
    wins: 'Wins',
    damage: 'Damage',
    matches: 'Matches',
  };
  const fields = Object.entries(currentStats).map(([key, value]) => {
    const previous = previousStats?.[key];
    const delta = typeof previous === 'number' ? value - previous : null;
    const deltaText =
      delta === null
        ? 'New baseline'
        : delta === 0
          ? 'No change'
          : `${delta > 0 ? '+' : ''}${formatNumericValue(delta)}`;

    return {
      name: labels[key] ?? key,
      value: `Current: **${formatNumericValue(value)}**\nChange: **${deltaText}**`,
      inline: true,
    };
  });

  return {
    title: `Apex Watch: ${target.displayName}`,
    description: previousStats
      ? `Changes since ${previousCapturedAt ?? 'the last snapshot'}.`
      : 'Baseline saved. Run this again later to see changes.',
    color: DEFAULT_EMBED_COLOR,
    fields:
      fields.length > 0
        ? fields
        : [
            {
              name: 'Stats',
              value: 'No numeric watchable stats were returned.',
              inline: false,
            },
          ],
    footer: `${getPlatformLabel(target.appPlatform)} • watch snapshot updated`,
  };
};

export const resolveProfileDisplayName = (
  profile: ApexProfile,
  fallback: string,
): string => getPlayerDisplayName(profile, fallback);

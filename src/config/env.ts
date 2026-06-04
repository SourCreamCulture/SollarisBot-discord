import 'dotenv/config';

import { resolve } from 'node:path';

import { z } from 'zod';

import { DEFAULT_APEX_LINKS_FILE } from '../apex/platform';
import { DEFAULT_APEX_WATCH_FILE } from '../apex/watchStore';
import { DEFAULT_VALORANT_LEADERBOARD_STATE_FILE } from '../valorant/leaderboardStore';
import { DEFAULT_VALORANT_LINKS_FILE } from '../valorant/platform';
import { DEFAULT_MUSIC_LIBRARY_FILE } from '../music/library';
import { DEFAULT_MUSIC_STATS_FILE } from '../music/stats';
import {
  DEFAULT_MUSIC_QUEUE_RESTORE_MAX_AGE_MS,
  DEFAULT_MUSIC_QUEUE_STATE_FILE,
} from '../music/queueState';
import { DEFAULT_MUSIC_SETTINGS_FILE } from '../music/settings';
import type { BotConfig, LogLevel } from '../types/bot';
import { DEFAULT_UTILITY_STORE_FILE } from '../utils/utilityStore';

const YOUTUBE_EXTRACTOR_ID =
  'com.retrouser955.discord-player.discord-player-youtubei';

const schema = z
  .object({
    DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
    DISCORD_CLIENT_ID: z.string().min(1, 'DISCORD_CLIENT_ID is required'),
    DISCORD_GUILD_ID: z.string().min(1).optional(),
    APEX_STATS_PROVIDER: z.enum(['tracker', 'mozambique']).default('tracker'),
    TRACKER_API_KEY: z.string().min(1).optional(),
    MOZAMBIQUE_API_KEY: z.string().min(1).optional(),
    APEX_LINKS_FILE: z.string().min(1).default(DEFAULT_APEX_LINKS_FILE),
    APEX_WATCH_FILE: z.string().min(1).default(DEFAULT_APEX_WATCH_FILE),
    HENRIKDEV_API_KEY: z.string().min(1).optional(),
    VALORANT_LINKS_FILE: z.string().min(1).default(DEFAULT_VALORANT_LINKS_FILE),
    VALORANT_LEADERBOARD_CHANNEL_ID: z.string().min(1).optional(),
    VALORANT_LEADERBOARD_STATE_FILE: z
      .string()
      .min(1)
      .default(DEFAULT_VALORANT_LEADERBOARD_STATE_FILE),
    VALORANT_LEADERBOARD_REFRESH_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .default(600_000),
    LOG_LEVEL: z
      .enum(['debug', 'info', 'warn', 'error'] satisfies [
        LogLevel,
        ...LogLevel[],
      ])
      .default('info'),
    MUSIC_DEFAULT_VOLUME: z.coerce.number().int().min(1).max(100).default(80),
    MUSIC_SETTINGS_FILE: z.string().min(1).default(DEFAULT_MUSIC_SETTINGS_FILE),
    MUSIC_LIBRARY_FILE: z.string().min(1).default(DEFAULT_MUSIC_LIBRARY_FILE),
    MUSIC_STATS_FILE: z.string().min(1).default(DEFAULT_MUSIC_STATS_FILE),
    MUSIC_QUEUE_STATE_FILE: z
      .string()
      .min(1)
      .default(DEFAULT_MUSIC_QUEUE_STATE_FILE),
    MUSIC_QUEUE_RESTORE_MAX_AGE_MS: z.coerce
      .number()
      .int()
      .min(0)
      .default(DEFAULT_MUSIC_QUEUE_RESTORE_MAX_AGE_MS),
    MUSIC_VOTE_SKIP_THRESHOLD: z.coerce.number().min(0.1).max(1).default(0.5),
    MUSIC_LEAVE_ON_EMPTY_COOLDOWN_MS: z.coerce
      .number()
      .int()
      .min(0)
      .default(30_000),
    MUSIC_LEAVE_ON_END_COOLDOWN_MS: z.coerce
      .number()
      .int()
      .min(0)
      .default(30_000),
    MUSIC_LEAVE_ON_STOP_COOLDOWN_MS: z.coerce
      .number()
      .int()
      .min(0)
      .default(1_000),
    UTILITY_STORE_FILE: z.string().min(1).default(DEFAULT_UTILITY_STORE_FILE),
  })
  .superRefine((env, context) => {
    if (env.APEX_STATS_PROVIDER === 'tracker' && !env.TRACKER_API_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['TRACKER_API_KEY'],
        message: 'TRACKER_API_KEY is required when APEX_STATS_PROVIDER=tracker',
      });
    }

    if (env.APEX_STATS_PROVIDER === 'mozambique' && !env.MOZAMBIQUE_API_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['MOZAMBIQUE_API_KEY'],
        message:
          'MOZAMBIQUE_API_KEY is required when APEX_STATS_PROVIDER=mozambique',
      });
    }
  });

export const loadConfig = (): BotConfig => {
  const result = schema.safeParse(process.env);

  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(`Invalid environment configuration:\n${message}`);
  }

  const env = result.data;

  return {
    discordToken: env.DISCORD_TOKEN,
    discordClientId: env.DISCORD_CLIENT_ID,
    discordGuildId: env.DISCORD_GUILD_ID,
    logLevel: env.LOG_LEVEL,
    apex: {
      provider: env.APEX_STATS_PROVIDER,
      trackerApiKey: env.TRACKER_API_KEY,
      mozambiqueApiKey: env.MOZAMBIQUE_API_KEY,
      linksFile: resolve(env.APEX_LINKS_FILE),
      watchFile: resolve(env.APEX_WATCH_FILE),
    },
    valorant: {
      henrikDevApiKey: env.HENRIKDEV_API_KEY,
      linksFile: resolve(env.VALORANT_LINKS_FILE),
      leaderboardChannelId: env.VALORANT_LEADERBOARD_CHANNEL_ID,
      leaderboardStateFile: resolve(env.VALORANT_LEADERBOARD_STATE_FILE),
      leaderboardRefreshIntervalMs:
        env.VALORANT_LEADERBOARD_REFRESH_INTERVAL_MS,
    },
    music: {
      defaultVolume: env.MUSIC_DEFAULT_VOLUME,
      settingsFile: resolve(env.MUSIC_SETTINGS_FILE),
      libraryFile: resolve(env.MUSIC_LIBRARY_FILE),
      statsFile: resolve(env.MUSIC_STATS_FILE),
      queueStateFile: resolve(env.MUSIC_QUEUE_STATE_FILE),
      queueRestoreMaxAgeMs: env.MUSIC_QUEUE_RESTORE_MAX_AGE_MS,
      voteSkipThreshold: env.MUSIC_VOTE_SKIP_THRESHOLD,
      leaveOnEmptyCooldownMs: env.MUSIC_LEAVE_ON_EMPTY_COOLDOWN_MS,
      leaveOnEndCooldownMs: env.MUSIC_LEAVE_ON_END_COOLDOWN_MS,
      leaveOnStopCooldownMs: env.MUSIC_LEAVE_ON_STOP_COOLDOWN_MS,
      youtubeSearchEngine: `ext:${YOUTUBE_EXTRACTOR_ID}`,
    },
    utility: {
      storeFile: resolve(env.UTILITY_STORE_FILE),
    },
  };
};

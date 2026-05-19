import { Client, GatewayIntentBits, type User } from 'discord.js';

import { migrateSavedSpotifyTracksToYoutube } from '../music/libraryMigration';
import { createJsonMusicLibraryService } from '../music/library';
import { createMusicPlayer } from '../music/service';
import type { BotConfig, LogLevel } from '../types/bot';
import { createLogger } from '../utils/logger';

const allowedLogLevels = new Set<LogLevel>(['debug', 'info', 'warn', 'error']);
const youtubeExtractorId =
  'com.retrouser955.discord-player.discord-player-youtubei';

const resolveLogLevel = (): LogLevel => {
  const configuredLevel = process.env.LOG_LEVEL;
  return configuredLevel && allowedLogLevels.has(configuredLevel as LogLevel)
    ? (configuredLevel as LogLevel)
    : 'info';
};

const createMigrationConfig = (): BotConfig => {
  const libraryFile = process.env.MUSIC_LIBRARY_FILE?.trim() || 'data/music-library.json';
  const logLevel = resolveLogLevel();

  return {
    discordToken: '',
    discordClientId: '',
    logLevel,
    apex: {
      provider: 'tracker',
      linksFile: '',
    },
    music: {
      defaultVolume: 80,
      settingsFile: '',
      libraryFile,
      queueStateFile: '',
      voteSkipThreshold: 0.5,
      leaveOnEmptyCooldownMs: 0,
      leaveOnEndCooldownMs: 0,
      leaveOnStopCooldownMs: 0,
      youtubeSearchEngine: `ext:${youtubeExtractorId}`,
    },
  };
};

export const runSpotifyLibraryMigration = async (): Promise<void> => {
  const config = createMigrationConfig();
  const logger = createLogger(config.logLevel);
  const library = await createJsonMusicLibraryService(config.music.libraryFile, logger);
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });
  const player = await createMusicPlayer(client, config, logger);
  const requestedBy = { id: 'spotify-library-migration' } as User;

  try {
    logger.info(`Scanning music library at ${config.music.libraryFile}.`);

    const result = await migrateSavedSpotifyTracksToYoutube(
      library,
      player,
      config,
      requestedBy,
    );

    logger.info(
      `Processed ${result.totalTrackCount} saved track(s); found ${result.matchedTrackCount} Spotify track(s).`,
    );
    logger.info(
      `Converted ${result.updatedTrackCount} track(s) to YouTube URLs and left ${result.unresolvedTrackCount} unmatched track(s) unchanged.`,
    );
  } finally {
    client.destroy();
  }
};

void runSpotifyLibraryMigration().catch((error) => {
  console.error('Failed to migrate saved Spotify tracks.', error);
  process.exitCode = 1;
});

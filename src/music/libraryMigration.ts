import type { Player } from 'discord-player';
import type { User } from 'discord.js';

import {
  type MusicLibraryService,
  type SavedTrack,
  type SavedTrackRewriteResult,
} from './library';
import {
  isSpotifyTrackQuery,
  resolveSavedSpotifyTrackToYoutubeTrack,
} from './spotify';
import type { BotConfig } from '../types/bot';

export interface SavedSpotifyTrackMigrationResult extends SavedTrackRewriteResult {
  unresolvedTrackCount: number;
}

type YoutubeMigrationConfig = {
  music: Pick<BotConfig['music'], 'youtubeSearchEngine'>;
};

export type SavedSpotifyTrackUrlResolver = (
  track: SavedTrack,
) => Promise<string | null>;

const normalizeCacheKey = (url: string): string => url.trim().toLowerCase();

export const migrateSavedSpotifyTracks = async (
  library: MusicLibraryService,
  resolveYoutubeUrl: SavedSpotifyTrackUrlResolver,
): Promise<SavedSpotifyTrackMigrationResult> => {
  const resolutionCache = new Map<string, string | null>();
  let unresolvedTrackCount = 0;

  const rewriteResult = await library.rewriteTracks(
    (track) => isSpotifyTrackQuery(track.url),
    async (track) => {
      const cacheKey = normalizeCacheKey(track.url);
      let youtubeUrl = resolutionCache.get(cacheKey);

      if (youtubeUrl === undefined) {
        youtubeUrl = await resolveYoutubeUrl(track);
        resolutionCache.set(cacheKey, youtubeUrl);
      }

      if (!youtubeUrl) {
        unresolvedTrackCount += 1;
        return null;
      }

      return {
        ...track,
        url: youtubeUrl,
      };
    },
  );

  return {
    ...rewriteResult,
    unresolvedTrackCount,
  };
};

export const migrateSavedSpotifyTracksToYoutube = async (
  library: MusicLibraryService,
  player: Player,
  config: YoutubeMigrationConfig,
  requestedBy: User,
): Promise<SavedSpotifyTrackMigrationResult> =>
  migrateSavedSpotifyTracks(library, async (track) => {
    const matchedTrack = await resolveSavedSpotifyTrackToYoutubeTrack(
      player,
      config,
      requestedBy,
      track,
    );

    return matchedTrack?.url ?? null;
  });

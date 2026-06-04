import {
  QueryType,
  type Player,
  type SearchQueryType,
  type Track,
} from 'discord-player';
import type { User } from 'discord.js';

import type { BotConfig } from '../types/bot';
import type { SavedTrack } from './library';
import { UserFacingError } from '../utils/errors';

const SPOTIFY_PLAYLIST_QUERY_PATTERN =
  /(?:spotify:playlist:|open\.spotify\.com\/(?:intl-[^/]+\/)?playlist\/)/i;
const SPOTIFY_TRACK_QUERY_PATTERN =
  /(?:spotify:track:|open\.spotify\.com\/(?:intl-[^/]+\/)?tracks?\/)/i;
const DIRECT_URL_PATTERN = /^(https?:\/\/|spotify:)/i;
const SPOTIFY_RESOLUTION_CONCURRENCY = 4;

export interface SavedTrackPlaybackRequest {
  query: string;
  searchEngine: SearchQueryType | `ext:${string}`;
}

export interface SpotifyPlaylistResolution {
  title: string;
  sourceUrl: string;
  requestedTrackCount: number;
  resolvedTracks: Track[];
  unresolvedTracks: Array<{
    title: string;
    author: string;
  }>;
}

type YoutubeSearchConfig = {
  music: Pick<BotConfig['music'], 'youtubeSearchEngine'>;
};

const normalizeWhitespace = (value: string): string =>
  value.replace(/\s+/g, ' ').trim();

const sanitizeTrackTitle = (title: string): string =>
  normalizeWhitespace(
    title
      .replace(/\s*\((?:feat\.?|ft\.?|with)\b[^)]*\)/gi, ' ')
      .replace(/\s*\[(?:feat\.?|ft\.?|with)\b[^\]]*\]/gi, ' ')
      .replace(
        /\s*\((?:official|audio|video|visualizer|lyrics?|remaster(?:ed)?|live)\b[^)]*\)/gi,
        ' ',
      )
      .replace(
        /\s*\[(?:official|audio|video|visualizer|lyrics?|remaster(?:ed)?|live)\b[^\]]*\]/gi,
        ' ',
      ),
  );

const buildYoutubeSearchQueries = (title: string, author: string): string[] => {
  const cleanTitle = sanitizeTrackTitle(title);
  const cleanAuthor = normalizeWhitespace(author) || 'Unknown Artist';
  const queries = [
    `${cleanAuthor} ${cleanTitle} audio`,
    `${cleanAuthor} ${cleanTitle}`,
    `${cleanTitle} ${cleanAuthor}`,
  ];

  return [...new Set(queries.map(normalizeWhitespace).filter(Boolean))];
};

const resolveYoutubeTrackFromMetadata = async (
  player: Player,
  config: YoutubeSearchConfig,
  requestedBy: User,
  title: string,
  author: string,
): Promise<Track | null> => {
  for (const query of buildYoutubeSearchQueries(title, author)) {
    const result = await player.search(query, {
      requestedBy,
      searchEngine: config.music.youtubeSearchEngine,
    });

    if (!result.isEmpty() && result.tracks[0]) {
      return result.tracks[0];
    }
  }

  return null;
};

export const isSpotifyPlaylistQuery = (query: string): boolean =>
  SPOTIFY_PLAYLIST_QUERY_PATTERN.test(query.trim());

export const isSpotifyTrackQuery = (query: string): boolean =>
  SPOTIFY_TRACK_QUERY_PATTERN.test(query.trim());

export const buildSavedTrackPlaybackRequest = (
  config: YoutubeSearchConfig,
  track: SavedTrack,
): SavedTrackPlaybackRequest => {
  if (isSpotifyTrackQuery(track.url)) {
    return {
      query:
        buildYoutubeSearchQueries(track.title, track.author)[0] ?? track.title,
      searchEngine: config.music.youtubeSearchEngine,
    };
  }

  return {
    query: track.url,
    searchEngine: DIRECT_URL_PATTERN.test(track.url.trim())
      ? QueryType.AUTO
      : config.music.youtubeSearchEngine,
  };
};

export const resolveSavedSpotifyTrackToYoutubeTrack = async (
  player: Player,
  config: YoutubeSearchConfig,
  requestedBy: User,
  track: SavedTrack,
): Promise<Track | null> =>
  resolveYoutubeTrackFromMetadata(
    player,
    config,
    requestedBy,
    track.title,
    track.author,
  );

export const resolveSpotifyPlaylistToYoutubeTracks = async (
  player: Player,
  config: YoutubeSearchConfig,
  requestedBy: User,
  url: string,
): Promise<SpotifyPlaylistResolution> => {
  const spotifyResult = await player.search(url, {
    requestedBy,
    searchEngine: QueryType.SPOTIFY_PLAYLIST,
  });

  if (spotifyResult.isEmpty() || !spotifyResult.playlist) {
    throw new UserFacingError('I could not read that Spotify playlist.');
  }

  const resolvedTracks: Array<Track | null> = new Array(
    spotifyResult.tracks.length,
  ).fill(null);
  const unresolvedTracks: SpotifyPlaylistResolution['unresolvedTracks'] = [];
  const cache = new Map<string, Track | null>();
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < spotifyResult.tracks.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      const spotifyTrack = spotifyResult.tracks[currentIndex];
      const cacheKey = `${spotifyTrack.author.toLowerCase()}::${sanitizeTrackTitle(
        spotifyTrack.title,
      ).toLowerCase()}`;

      let resolvedTrack = cache.get(cacheKey);

      if (resolvedTrack === undefined) {
        resolvedTrack = await resolveYoutubeTrackFromMetadata(
          player,
          config,
          requestedBy,
          spotifyTrack.title,
          spotifyTrack.author,
        );
        cache.set(cacheKey, resolvedTrack);
      }

      resolvedTracks[currentIndex] = resolvedTrack;

      if (!resolvedTrack) {
        unresolvedTracks.push({
          title: spotifyTrack.title,
          author: spotifyTrack.author,
        });
      }
    }
  };

  await Promise.all(
    Array.from(
      {
        length: Math.min(
          SPOTIFY_RESOLUTION_CONCURRENCY,
          spotifyResult.tracks.length,
        ),
      },
      () => worker(),
    ),
  );

  return {
    title: spotifyResult.playlist.title,
    sourceUrl: spotifyResult.playlist.url,
    requestedTrackCount: spotifyResult.tracks.length,
    resolvedTracks: resolvedTracks.filter((track): track is Track =>
      Boolean(track),
    ),
    unresolvedTracks,
  };
};

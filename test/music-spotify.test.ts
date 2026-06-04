import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { QueryType, type Player, type Track } from 'discord-player';
import type { User } from 'discord.js';

import {
  buildSavedTrackPlaybackRequest,
  isSpotifyTrackQuery,
  resolveSpotifyPlaylistToYoutubeTracks,
} from '../src/music/spotify';
import type { BotConfig } from '../src/types/bot';
import type { SavedTrack } from '../src/music/library';

const config = {
  music: {
    youtubeSearchEngine: 'ext:test-youtube',
  },
} as BotConfig;

const requestedBy = { id: 'user-1' } as User;

const createTrack = (input: {
  title: string;
  author: string;
  url: string;
}): Track =>
  ({
    title: input.title,
    author: input.author,
    url: input.url,
  }) as Track;

const createSavedTrack = (url: string): SavedTrack => ({
  title: 'Lights',
  url,
  duration: '3:30',
  author: 'Ellie Goulding',
  addedById: 'user-1',
  addedAt: '2026-05-10T00:00:00.000Z',
});

describe('music spotify helpers', () => {
  it('uses a YouTube search query when replaying saved Spotify tracks', () => {
    const playbackRequest = buildSavedTrackPlaybackRequest(
      config,
      createSavedTrack('https://open.spotify.com/track/1234567890123456789012'),
    );

    assert.equal(
      playbackRequest.searchEngine,
      config.music.youtubeSearchEngine,
    );
    assert.match(playbackRequest.query, /ellie goulding lights/i);
  });

  it('recognizes legacy plural Spotify track URLs from saved library imports', () => {
    const legacyUrl = 'https://open.spotify.com/tracks/2799b6f5b391fbb4';

    assert.equal(isSpotifyTrackQuery(legacyUrl), true);

    const playbackRequest = buildSavedTrackPlaybackRequest(
      config,
      createSavedTrack(legacyUrl),
    );

    assert.equal(
      playbackRequest.searchEngine,
      config.music.youtubeSearchEngine,
    );
    assert.match(playbackRequest.query, /ellie goulding lights/i);
  });

  it('keeps direct playback URLs for non-Spotify saved tracks', () => {
    const playbackRequest = buildSavedTrackPlaybackRequest(
      config,
      createSavedTrack('https://www.youtube.com/watch?v=abc123'),
    );

    assert.equal(
      playbackRequest.query,
      'https://www.youtube.com/watch?v=abc123',
    );
    assert.equal(playbackRequest.searchEngine, QueryType.AUTO);
  });

  it('resolves Spotify playlist songs to YouTube tracks and reports misses', async () => {
    const spotifyPlaylistUrl =
      'https://open.spotify.com/playlist/1234567890123456789012';
    const searchCalls: Array<{ query: string; searchEngine: string }> = [];

    const player = {
      search: async (query: string, options: { searchEngine: string }) => {
        searchCalls.push({
          query,
          searchEngine: options.searchEngine,
        });

        if (query === spotifyPlaylistUrl) {
          return {
            isEmpty: () => false,
            playlist: {
              title: 'Road Trip',
              url: spotifyPlaylistUrl,
            },
            tracks: [
              createTrack({
                title: 'Midnight City',
                author: 'M83',
                url: 'https://open.spotify.com/track/1',
              }),
              createTrack({
                title: 'Missing Song (Live)',
                author: 'No Match',
                url: 'https://open.spotify.com/track/2',
              }),
            ],
          };
        }

        if (/m83 midnight city/i.test(query)) {
          return {
            isEmpty: () => false,
            tracks: [
              createTrack({
                title: 'Midnight City',
                author: 'M83',
                url: 'https://www.youtube.com/watch?v=dX3k_QDnzHE',
              }),
            ],
          };
        }

        return {
          isEmpty: () => true,
          tracks: [],
        };
      },
    } as unknown as Player;

    const result = await resolveSpotifyPlaylistToYoutubeTracks(
      player,
      config,
      requestedBy,
      spotifyPlaylistUrl,
    );

    assert.equal(searchCalls[0]?.searchEngine, QueryType.SPOTIFY_PLAYLIST);
    assert.equal(result.title, 'Road Trip');
    assert.equal(result.requestedTrackCount, 2);
    assert.equal(result.resolvedTracks.length, 1);
    assert.equal(
      result.resolvedTracks[0]?.url,
      'https://www.youtube.com/watch?v=dX3k_QDnzHE',
    );
    assert.deepEqual(result.unresolvedTracks, [
      {
        title: 'Missing Song (Live)',
        author: 'No Match',
      },
    ]);
  });
});

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import {
  createJsonMusicLibraryService,
  type SavedTrack,
} from '../src/music/library';
import {
  migrateSavedSpotifyTracks,
  migrateSavedSpotifyTracksToYoutube,
} from '../src/music/libraryMigration';
import type { BotConfig } from '../src/types/bot';
import type { Logger } from '../src/utils/logger';
import type { Player, Track } from 'discord-player';
import type { User } from 'discord.js';

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const tempDirectories: string[] = [];

const createTempStorePath = async (): Promise<string> => {
  const directory = await mkdtemp(
    join(tmpdir(), 'sollaris-music-library-migration-'),
  );
  tempDirectories.push(directory);
  return join(directory, 'data', 'music-library.json');
};

const createTrack = (input: {
  title: string;
  url: string;
  duration?: string;
  author?: string;
  addedById?: string;
  addedAt?: string;
}): SavedTrack => ({
  title: input.title,
  url: input.url,
  duration: input.duration ?? '3:00',
  author: input.author ?? 'Test Artist',
  addedById: input.addedById ?? 'user-1',
  addedAt: input.addedAt ?? '2026-05-10T00:00:00.000Z',
});

const createSearchTrack = (input: {
  title: string;
  author: string;
  url: string;
}): Track =>
  ({
    title: input.title,
    author: input.author,
    url: input.url,
  }) as Track;

const config = {
  music: {
    youtubeSearchEngine: 'ext:test-youtube',
  },
} as BotConfig;

const requestedBy = { id: 'spotify-library-migration' } as User;

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('migrateSavedSpotifyTracks', () => {
  it('replaces only Spotify URLs while preserving order and saved metadata', async () => {
    const filePath = await createTempStorePath();
    const library = await createJsonMusicLibraryService(filePath, logger);
    const spotifyFavorite = createTrack({
      title: 'Favorite Spotify Song',
      url: 'https://open.spotify.com/track/spotify-favorite',
      duration: '4:01',
      author: 'Favorite Artist',
      addedById: 'user-favorite',
      addedAt: '2026-05-01T00:00:00.000Z',
    });
    const untouchedFavorite = createTrack({
      title: 'Favorite YouTube Song',
      url: 'https://www.youtube.com/watch?v=favorite-yt',
      duration: '2:34',
      author: 'YouTube Artist',
      addedById: 'user-favorite-2',
      addedAt: '2026-05-02T00:00:00.000Z',
    });

    await library.addFavorite('user-1', spotifyFavorite);
    await library.addFavorite('user-1', untouchedFavorite);

    await library.createPlaylist('guild-1', 'Road Trip', 'user-1');

    const playlistTracks = [
      createTrack({
        title: 'First Spotify Song',
        url: 'https://open.spotify.com/track/spotify-playlist-1',
        duration: '3:10',
        author: 'Artist One',
        addedById: 'playlist-user-1',
        addedAt: '2026-05-03T00:00:00.000Z',
      }),
      createTrack({
        title: 'Unmatched Spotify Song',
        url: 'https://open.spotify.com/track/spotify-playlist-2',
        duration: '3:20',
        author: 'Artist Two',
        addedById: 'playlist-user-2',
        addedAt: '2026-05-04T00:00:00.000Z',
      }),
      createTrack({
        title: 'Existing YouTube Song',
        url: 'https://www.youtube.com/watch?v=playlist-yt',
        duration: '3:30',
        author: 'Artist Three',
        addedById: 'playlist-user-3',
        addedAt: '2026-05-05T00:00:00.000Z',
      }),
      createTrack({
        title: 'Duplicate Spotify Song',
        url: 'https://open.spotify.com/track/spotify-playlist-1',
        duration: '3:10',
        author: 'Artist One',
        addedById: 'playlist-user-4',
        addedAt: '2026-05-06T00:00:00.000Z',
      }),
    ];

    for (const track of playlistTracks) {
      await library.addPlaylistTrack('guild-1', 'Road Trip', track);
    }

    const playlistBeforeMigration = library.getPlaylist('guild-1', 'Road Trip');
    assert.ok(playlistBeforeMigration);

    const resolverCalls: string[] = [];
    const result = await migrateSavedSpotifyTracks(library, async (track) => {
      resolverCalls.push(track.url);

      switch (track.url) {
        case 'https://open.spotify.com/track/spotify-favorite':
          return 'https://www.youtube.com/watch?v=favorite-converted';
        case 'https://open.spotify.com/track/spotify-playlist-1':
          return 'https://www.youtube.com/watch?v=playlist-converted-1';
        default:
          return null;
      }
    });

    assert.equal(result.totalTrackCount, 6);
    assert.equal(result.matchedTrackCount, 4);
    assert.equal(result.updatedTrackCount, 3);
    assert.equal(result.unresolvedTrackCount, 1);
    assert.deepEqual(resolverCalls, [
      'https://open.spotify.com/track/spotify-favorite',
      'https://open.spotify.com/track/spotify-playlist-1',
      'https://open.spotify.com/track/spotify-playlist-2',
    ]);

    const favorites = library.listFavorites('user-1');
    assert.equal(favorites[0]?.url, untouchedFavorite.url);
    assert.equal(favorites[0]?.title, untouchedFavorite.title);
    assert.equal(
      favorites[1]?.url,
      'https://www.youtube.com/watch?v=favorite-converted',
    );
    assert.equal(favorites[1]?.title, spotifyFavorite.title);
    assert.equal(favorites[1]?.duration, spotifyFavorite.duration);
    assert.equal(favorites[1]?.author, spotifyFavorite.author);
    assert.equal(favorites[1]?.addedById, spotifyFavorite.addedById);
    assert.equal(favorites[1]?.addedAt, spotifyFavorite.addedAt);

    const playlist = library.getPlaylist('guild-1', 'Road Trip');
    assert.ok(playlist);
    assert.deepEqual(
      playlist.tracks.map((track) => track.url),
      [
        'https://www.youtube.com/watch?v=playlist-converted-1',
        'https://open.spotify.com/track/spotify-playlist-2',
        'https://www.youtube.com/watch?v=playlist-yt',
        'https://www.youtube.com/watch?v=playlist-converted-1',
      ],
    );
    assert.deepEqual(
      playlist.tracks.map((track) => track.title),
      playlistTracks.map((track) => track.title),
    );
    assert.deepEqual(
      playlist.tracks.map((track) => track.addedAt),
      playlistTracks.map((track) => track.addedAt),
    );

    const storedFile = JSON.parse(await readFile(filePath, 'utf8')) as {
      guilds: {
        'guild-1': {
          playlists: {
            'road-trip': {
              updatedAt: string;
            };
          };
        };
      };
    };

    assert.equal(
      storedFile.guilds['guild-1'].playlists['road-trip'].updatedAt,
      playlistBeforeMigration.updatedAt,
    );
  });

  it('migrates spotify tracks from file-backed playlists like dallin and juice using the youtube matcher', async () => {
    const filePath = await createTempStorePath();
    const rawLibrary = {
      version: 1,
      users: {},
      guilds: {
        'guild-1': {
          playlists: {
            dallin: {
              name: 'dallin',
              slug: 'dallin',
              createdById: 'user-dallin',
              createdAt: '2026-05-01T00:00:00.000Z',
              updatedAt: '2026-05-01T00:00:00.000Z',
              tracks: [
                createTrack({
                  title: 'Ghost Town (Live)',
                  author: 'Artist One',
                  url: 'https://open.spotify.com/tracks/spotify-dallin-1',
                  duration: '3:21',
                  addedById: 'user-dallin-track-1',
                  addedAt: '2026-05-02T00:00:00.000Z',
                }),
                createTrack({
                  title: 'Already Youtube',
                  author: 'Artist Two',
                  url: 'https://www.youtube.com/watch?v=already-youtube',
                  duration: '2:58',
                  addedById: 'user-dallin-track-2',
                  addedAt: '2026-05-03T00:00:00.000Z',
                }),
              ],
            },
            juice: {
              name: 'juice',
              slug: 'juice',
              createdById: 'user-juice',
              createdAt: '2026-05-04T00:00:00.000Z',
              updatedAt: '2026-05-04T00:00:00.000Z',
              tracks: [
                createTrack({
                  title: 'Late Night (feat. Friend)',
                  author: 'Artist Three',
                  url: 'https://open.spotify.com/tracks/spotify-juice-1',
                  duration: '4:05',
                  addedById: 'user-juice-track-1',
                  addedAt: '2026-05-05T00:00:00.000Z',
                }),
                createTrack({
                  title: 'Ghost Town (Live)',
                  author: 'Artist One',
                  url: 'https://open.spotify.com/tracks/spotify-dallin-1',
                  duration: '3:21',
                  addedById: 'user-juice-track-2',
                  addedAt: '2026-05-06T00:00:00.000Z',
                }),
              ],
            },
          },
        },
      },
    };

    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      `${JSON.stringify(rawLibrary, null, 2)}\n`,
      'utf8',
    );

    const library = await createJsonMusicLibraryService(filePath, logger);
    const searchCalls: Array<{ query: string; searchEngine: string }> = [];
    const player = {
      search: async (query: string, options: { searchEngine: string }) => {
        searchCalls.push({
          query,
          searchEngine: options.searchEngine,
        });

        if (/artist one ghost town audio/i.test(query)) {
          return {
            isEmpty: () => false,
            tracks: [
              createSearchTrack({
                title: 'Ghost Town',
                author: 'Artist One',
                url: 'https://www.youtube.com/watch?v=ghost-town-youtube',
              }),
            ],
          };
        }

        if (/artist three late night audio/i.test(query)) {
          return {
            isEmpty: () => false,
            tracks: [
              createSearchTrack({
                title: 'Late Night',
                author: 'Artist Three',
                url: 'https://www.youtube.com/watch?v=late-night-youtube',
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

    const result = await migrateSavedSpotifyTracksToYoutube(
      library,
      player,
      config,
      requestedBy,
    );

    assert.equal(result.totalTrackCount, 4);
    assert.equal(result.matchedTrackCount, 3);
    assert.equal(result.updatedTrackCount, 3);
    assert.equal(result.unresolvedTrackCount, 0);

    assert.deepEqual(searchCalls, [
      {
        query: 'Artist One Ghost Town audio',
        searchEngine: 'ext:test-youtube',
      },
      {
        query: 'Artist Three Late Night audio',
        searchEngine: 'ext:test-youtube',
      },
    ]);

    const dallin = library.getPlaylist('guild-1', 'dallin');
    const juice = library.getPlaylist('guild-1', 'juice');

    assert.ok(dallin);
    assert.ok(juice);

    assert.deepEqual(
      dallin.tracks.map((track) => track.url),
      [
        'https://www.youtube.com/watch?v=ghost-town-youtube',
        'https://www.youtube.com/watch?v=already-youtube',
      ],
    );
    assert.deepEqual(
      juice.tracks.map((track) => track.url),
      [
        'https://www.youtube.com/watch?v=late-night-youtube',
        'https://www.youtube.com/watch?v=ghost-town-youtube',
      ],
    );

    assert.deepEqual(
      dallin.tracks.map((track) => track.addedAt),
      rawLibrary.guilds['guild-1'].playlists.dallin.tracks.map(
        (track) => track.addedAt,
      ),
    );
    assert.deepEqual(
      juice.tracks.map((track) => track.addedById),
      rawLibrary.guilds['guild-1'].playlists.juice.tracks.map(
        (track) => track.addedById,
      ),
    );

    const storedFile = JSON.parse(
      await readFile(filePath, 'utf8'),
    ) as typeof rawLibrary;
    assert.equal(
      storedFile.guilds['guild-1'].playlists.dallin.updatedAt,
      rawLibrary.guilds['guild-1'].playlists.dallin.updatedAt,
    );
    assert.equal(
      storedFile.guilds['guild-1'].playlists.juice.updatedAt,
      rawLibrary.guilds['guild-1'].playlists.juice.updatedAt,
    );
  });
});

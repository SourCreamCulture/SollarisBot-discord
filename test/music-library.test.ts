import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import {
  createJsonMusicLibraryService,
  type SavedTrack,
} from '../src/music/library';
import type { Logger } from '../src/utils/logger';

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const tempDirectories: string[] = [];

const createTempStorePath = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'sollaris-music-library-'));
  tempDirectories.push(directory);
  return join(directory, 'data', 'music-library.json');
};

const createTrack = (suffix: string): SavedTrack => ({
  title: `Track ${suffix}`,
  url: `https://example.com/track-${suffix}`,
  duration: '3:00',
  author: 'Test Artist',
  addedById: 'user-1',
  addedAt: '2026-04-23T00:00:00.000Z',
});

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('createJsonMusicLibraryService', () => {
  it('skips duplicates when importing with skip-duplicates mode', async () => {
    const filePath = await createTempStorePath();
    const library = await createJsonMusicLibraryService(filePath, logger);
    await library.createPlaylist('guild-1', 'Road Trip', 'user-1');
    await library.addPlaylistTrack('guild-1', 'Road Trip', createTrack('a'));

    const result = await library.importPlaylistTracks(
      'guild-1',
      'Road Trip',
      [createTrack('a'), createTrack('b'), createTrack('b')],
      'skip-duplicates',
    );

    assert.equal(result.mode, 'skip-duplicates');
    assert.equal(result.addedCount, 1);
    assert.equal(result.skippedDuplicates, 2);
    assert.equal(result.skippedOverflow, 0);
    assert.deepEqual(
      result.playlist.tracks.map((track) => track.title),
      ['Track a', 'Track b'],
    );
  });

  it('replaces existing tracks and caps imported tracks at the playlist limit', async () => {
    const filePath = await createTempStorePath();
    const library = await createJsonMusicLibraryService(filePath, logger);
    await library.createPlaylist('guild-1', 'Gym Mix', 'user-1');
    await library.addPlaylistTrack('guild-1', 'Gym Mix', createTrack('seed'));

    const importedTracks = Array.from({ length: 80 }, (_, index) =>
      createTrack(String(index + 1)),
    );

    const result = await library.importPlaylistTracks(
      'guild-1',
      'Gym Mix',
      importedTracks,
      'replace',
    );

    assert.equal(result.mode, 'replace');
    assert.equal(result.addedCount, 75);
    assert.equal(result.skippedDuplicates, 0);
    assert.equal(result.skippedOverflow, 5);
    assert.equal(result.playlist.tracks.length, 75);
    assert.equal(result.playlist.tracks[0]?.title, 'Track 1');
    assert.equal(result.playlist.tracks.at(-1)?.title, 'Track 75');
  });
});

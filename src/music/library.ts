import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';
import type { Track } from 'discord-player';

import type { Logger } from '../utils/logger';

export const DEFAULT_MUSIC_LIBRARY_FILE = 'data/music-library.json';

export interface SavedTrack {
  title: string;
  url: string;
  duration: string;
  author: string;
  addedById: string;
  addedAt: string;
}

export interface SavedPlaylist {
  name: string;
  slug: string;
  tracks: SavedTrack[];
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export type PlaylistImportMode = 'append' | 'skip-duplicates' | 'replace';

export interface PlaylistImportResult {
  playlist: SavedPlaylist;
  addedCount: number;
  skippedDuplicates: number;
  skippedOverflow: number;
  mode: PlaylistImportMode;
}

export interface SavedTrackRewriteResult {
  totalTrackCount: number;
  matchedTrackCount: number;
  updatedTrackCount: number;
}

export interface MusicLibraryService {
  addFavorite(userId: string, track: SavedTrack): Promise<SavedTrack[]>;
  listFavorites(userId: string): SavedTrack[];
  removeFavorite(userId: string, position: number): Promise<SavedTrack | null>;
  clearFavorites(userId: string): Promise<number>;
  createPlaylist(
    guildId: string,
    name: string,
    createdById: string,
  ): Promise<SavedPlaylist>;
  deletePlaylist(guildId: string, name: string): Promise<boolean>;
  listPlaylists(guildId: string): SavedPlaylist[];
  getPlaylist(guildId: string, name: string): SavedPlaylist | null;
  addPlaylistTrack(
    guildId: string,
    name: string,
    track: SavedTrack,
  ): Promise<SavedPlaylist>;
  removePlaylistTrack(
    guildId: string,
    name: string,
    position: number,
  ): Promise<{ playlist: SavedPlaylist; removed: SavedTrack } | null>;
  clearPlaylist(guildId: string, name: string): Promise<SavedPlaylist | null>;
  importPlaylistTracks(
    guildId: string,
    name: string,
    tracks: SavedTrack[],
    mode: PlaylistImportMode,
  ): Promise<PlaylistImportResult>;
  rewriteTracks(
    matcher: (track: SavedTrack) => boolean,
    replacer: (track: SavedTrack) => Promise<SavedTrack | null>,
  ): Promise<SavedTrackRewriteResult>;
}

const MAX_FAVORITES = 50;
const MAX_PLAYLISTS_PER_GUILD = 25;
const MAX_PLAYLIST_TRACKS = 75;

const savedTrackSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  duration: z.string().min(1),
  author: z.string(),
  addedById: z.string().min(1),
  addedAt: z.string().datetime(),
});

const savedPlaylistSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  tracks: z.array(savedTrackSchema),
  createdById: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const fileSchema = z.object({
  version: z.literal(1),
  users: z.record(
    z.string(),
    z.object({
      favorites: z.array(savedTrackSchema),
    }),
  ),
  guilds: z.record(
    z.string(),
    z.object({
      playlists: z.record(z.string(), savedPlaylistSchema),
    }),
  ),
});

type StoredFile = z.infer<typeof fileSchema>;

const createEmptyFile = (): StoredFile => ({
  version: 1,
  users: {},
  guilds: {},
});

const cloneTrack = (track: SavedTrack): SavedTrack => ({ ...track });

const clonePlaylist = (playlist: SavedPlaylist): SavedPlaylist => ({
  ...playlist,
  tracks: playlist.tracks.map(cloneTrack),
});

const writeJsonAtomic = async (
  filePath: string,
  payload: StoredFile,
): Promise<void> => {
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;

  await writeFile(temporaryPath, serialized, 'utf8');
  await rename(temporaryPath, filePath);
};

const slugify = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);

export const createSavedTrack = (track: Track, addedById: string): SavedTrack => ({
  title: track.title,
  url: track.url,
  duration: track.duration,
  author: track.author,
  addedById,
  addedAt: new Date().toISOString(),
});

class JsonMusicLibraryService implements MusicLibraryService {
  private data = createEmptyFile();
  private writeChain = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly logger: Logger,
  ) {}

  async initialize(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });

    try {
      const raw = await readFile(this.filePath, 'utf8');
      let parsedJson: unknown;

      try {
        parsedJson = JSON.parse(raw) as unknown;
      } catch (error) {
        throw new Error('Music library file contains invalid JSON.', {
          cause: error,
        });
      }

      const parsed = fileSchema.safeParse(parsedJson);

      if (!parsed.success) {
        throw new Error(
          `Music library file is invalid: ${parsed.error.issues
            .map((issue) => issue.message)
            .join(', ')}`,
        );
      }

      this.data = parsed.data;
      this.logger.debug('Loaded music library from disk.');
    } catch (error) {
      const isMissingFile =
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT';

      if (!isMissingFile) {
        throw error;
      }

      this.data = createEmptyFile();
      await writeJsonAtomic(this.filePath, this.data);
      this.logger.info(`Created music library store at ${this.filePath}.`);
    }
  }

  async addFavorite(userId: string, track: SavedTrack): Promise<SavedTrack[]> {
    const user = this.getOrCreateUser(userId);
    const withoutDuplicate = user.favorites.filter(
      (favorite) => favorite.url !== track.url,
    );

    user.favorites = [track, ...withoutDuplicate].slice(0, MAX_FAVORITES);
    await this.persist();
    return user.favorites.map(cloneTrack);
  }

  listFavorites(userId: string): SavedTrack[] {
    return this.data.users[userId]?.favorites.map(cloneTrack) ?? [];
  }

  async removeFavorite(
    userId: string,
    position: number,
  ): Promise<SavedTrack | null> {
    const user = this.getOrCreateUser(userId);
    const removed = user.favorites.splice(position - 1, 1)[0];

    if (!removed) {
      return null;
    }

    await this.persist();
    return cloneTrack(removed);
  }

  async clearFavorites(userId: string): Promise<number> {
    const user = this.getOrCreateUser(userId);
    const count = user.favorites.length;
    user.favorites = [];
    await this.persist();
    return count;
  }

  async createPlaylist(
    guildId: string,
    name: string,
    createdById: string,
  ): Promise<SavedPlaylist> {
    const guild = this.getOrCreateGuild(guildId);
    const slug = this.requireSlug(name);

    if (guild.playlists[slug]) {
      throw new Error(`A playlist named "${name}" already exists.`);
    }

    if (Object.keys(guild.playlists).length >= MAX_PLAYLISTS_PER_GUILD) {
      throw new Error(
        `This server already has ${MAX_PLAYLISTS_PER_GUILD} playlists.`,
      );
    }

    const now = new Date().toISOString();
    const playlist: SavedPlaylist = {
      name: name.trim(),
      slug,
      tracks: [],
      createdById,
      createdAt: now,
      updatedAt: now,
    };

    guild.playlists[slug] = playlist;
    await this.persist();
    return clonePlaylist(playlist);
  }

  async deletePlaylist(guildId: string, name: string): Promise<boolean> {
    const guild = this.getOrCreateGuild(guildId);
    const slug = this.requireSlug(name);
    const existed = Boolean(guild.playlists[slug]);

    if (!existed) {
      return false;
    }

    delete guild.playlists[slug];
    await this.persist();
    return true;
  }

  listPlaylists(guildId: string): SavedPlaylist[] {
    return Object.values(this.getOrCreateGuild(guildId).playlists)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(clonePlaylist);
  }

  getPlaylist(guildId: string, name: string): SavedPlaylist | null {
    const playlist = this.getOrCreateGuild(guildId).playlists[this.requireSlug(name)];
    return playlist ? clonePlaylist(playlist) : null;
  }

  async addPlaylistTrack(
    guildId: string,
    name: string,
    track: SavedTrack,
  ): Promise<SavedPlaylist> {
    const playlist = this.requirePlaylist(guildId, name);

    if (playlist.tracks.length >= MAX_PLAYLIST_TRACKS) {
      throw new Error(
        `Playlist "${playlist.name}" already has ${MAX_PLAYLIST_TRACKS} tracks.`,
      );
    }

    playlist.tracks.push(track);
    playlist.updatedAt = new Date().toISOString();
    await this.persist();
    return clonePlaylist(playlist);
  }

  async removePlaylistTrack(
    guildId: string,
    name: string,
    position: number,
  ): Promise<{ playlist: SavedPlaylist; removed: SavedTrack } | null> {
    const playlist = this.requirePlaylist(guildId, name);
    const removed = playlist.tracks.splice(position - 1, 1)[0];

    if (!removed) {
      return null;
    }

    playlist.updatedAt = new Date().toISOString();
    await this.persist();

    return {
      playlist: clonePlaylist(playlist),
      removed: cloneTrack(removed),
    };
  }

  async clearPlaylist(
    guildId: string,
    name: string,
  ): Promise<SavedPlaylist | null> {
    const playlist = this.getOrCreateGuild(guildId).playlists[this.requireSlug(name)];

    if (!playlist) {
      return null;
    }

    playlist.tracks = [];
    playlist.updatedAt = new Date().toISOString();
    await this.persist();
    return clonePlaylist(playlist);
  }

  async importPlaylistTracks(
    guildId: string,
    name: string,
    tracks: SavedTrack[],
    mode: PlaylistImportMode,
  ): Promise<PlaylistImportResult> {
    const playlist = this.requirePlaylist(guildId, name);
    const nextTracks = mode === 'replace' ? [] : [...playlist.tracks];
    const seenUrls =
      mode === 'skip-duplicates'
        ? new Set(nextTracks.map((track) => track.url))
        : null;

    let addedCount = 0;
    let skippedDuplicates = 0;
    let skippedOverflow = 0;

    for (const track of tracks) {
      if (seenUrls?.has(track.url)) {
        skippedDuplicates += 1;
        continue;
      }

      if (nextTracks.length >= MAX_PLAYLIST_TRACKS) {
        skippedOverflow += 1;
        continue;
      }

      nextTracks.push(track);
      seenUrls?.add(track.url);
      addedCount += 1;
    }

    playlist.tracks = nextTracks;
    playlist.updatedAt = new Date().toISOString();
    await this.persist();

    return {
      playlist: clonePlaylist(playlist),
      addedCount,
      skippedDuplicates,
      skippedOverflow,
      mode,
    };
  }

  async rewriteTracks(
    matcher: (track: SavedTrack) => boolean,
    replacer: (track: SavedTrack) => Promise<SavedTrack | null>,
  ): Promise<SavedTrackRewriteResult> {
    let totalTrackCount = 0;
    let matchedTrackCount = 0;
    let updatedTrackCount = 0;
    let hasChanges = false;

    for (const user of Object.values(this.data.users)) {
      for (const [index, track] of user.favorites.entries()) {
        totalTrackCount += 1;

        if (!matcher(track)) {
          continue;
        }

        matchedTrackCount += 1;
        const replacement = await replacer(cloneTrack(track));

        if (!replacement) {
          continue;
        }

        user.favorites[index] = replacement;
        updatedTrackCount += 1;
        hasChanges = true;
      }
    }

    for (const guild of Object.values(this.data.guilds)) {
      for (const playlist of Object.values(guild.playlists)) {
        for (const [index, track] of playlist.tracks.entries()) {
          totalTrackCount += 1;

          if (!matcher(track)) {
            continue;
          }

          matchedTrackCount += 1;
          const replacement = await replacer(cloneTrack(track));

          if (!replacement) {
            continue;
          }

          playlist.tracks[index] = replacement;
          updatedTrackCount += 1;
          hasChanges = true;
        }
      }
    }

    if (hasChanges) {
      await this.persist();
    }

    return {
      totalTrackCount,
      matchedTrackCount,
      updatedTrackCount,
    };
  }

  private getOrCreateUser(userId: string): StoredFile['users'][string] {
    this.data.users[userId] ??= {
      favorites: [],
    };

    return this.data.users[userId];
  }

  private getOrCreateGuild(guildId: string): StoredFile['guilds'][string] {
    this.data.guilds[guildId] ??= {
      playlists: {},
    };

    return this.data.guilds[guildId];
  }

  private requirePlaylist(guildId: string, name: string): SavedPlaylist {
    const playlist = this.getOrCreateGuild(guildId).playlists[this.requireSlug(name)];

    if (!playlist) {
      throw new Error(`Playlist "${name}" does not exist.`);
    }

    return playlist;
  }

  private requireSlug(name: string): string {
    const slug = slugify(name);

    if (!slug) {
      throw new Error('Playlist name must include letters or numbers.');
    }

    return slug;
  }

  private async persist(): Promise<void> {
    const snapshot: StoredFile = {
      version: 1,
      users: Object.fromEntries(
        Object.entries(this.data.users).map(([userId, user]) => [
          userId,
          { favorites: user.favorites.map(cloneTrack) },
        ]),
      ),
      guilds: Object.fromEntries(
        Object.entries(this.data.guilds).map(([guildId, guild]) => [
          guildId,
          {
            playlists: Object.fromEntries(
              Object.entries(guild.playlists).map(([slug, playlist]) => [
                slug,
                clonePlaylist(playlist),
              ]),
            ),
          },
        ]),
      ),
    };

    this.writeChain = this.writeChain.then(() =>
      writeJsonAtomic(this.filePath, snapshot),
    );

    await this.writeChain;
  }
}

export const createJsonMusicLibraryService = async (
  filePath: string,
  logger: Logger,
): Promise<MusicLibraryService> => {
  const service = new JsonMusicLibraryService(filePath, logger);
  await service.initialize();
  return service;
};

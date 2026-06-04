import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';
import type { Track } from 'discord-player';

import type { Logger } from '../utils/logger';

export const DEFAULT_MUSIC_STATS_FILE = 'data/music-stats.json';

export interface MusicStatsSnapshot {
  guildId: string;
  trackCount: number;
  totalSeconds: number;
  requesterCount: number;
  topTrack?: MusicTrackStat;
  topArtist?: MusicArtistStat;
  topRequester?: MusicRequesterStat;
}

export interface MusicUserStatsSnapshot {
  userId: string;
  trackCount: number;
  totalSeconds: number;
  favoriteArtist?: MusicArtistStat;
  currentStreakDays: number;
  longestStreakDays: number;
  badges: string[];
}

export interface MusicTrackStat {
  title: string;
  url: string;
  author: string;
  plays: number;
  totalSeconds: number;
}

export interface MusicArtistStat {
  name: string;
  plays: number;
  totalSeconds: number;
}

export interface MusicRequesterStat {
  userId: string;
  plays: number;
  totalSeconds: number;
}

export interface MusicStatsService {
  recordTrackStart(guildId: string, track: Track): Promise<void>;
  getServerStats(guildId: string): MusicStatsSnapshot;
  getUserStats(guildId: string, userId: string): MusicUserStatsSnapshot;
  getTopTracks(guildId: string, limit: number): MusicTrackStat[];
  getTopArtists(guildId: string, limit: number): MusicArtistStat[];
}

const trackSchema = z.object({
  title: z.string(),
  url: z.string(),
  author: z.string(),
  plays: z.number().int().min(0),
  totalSeconds: z.number().int().min(0),
});

const artistSchema = z.object({
  name: z.string(),
  plays: z.number().int().min(0),
  totalSeconds: z.number().int().min(0),
});

const requesterSchema = z.object({
  userId: z.string(),
  plays: z.number().int().min(0),
  totalSeconds: z.number().int().min(0),
});

const userSchema = z.object({
  trackCount: z.number().int().min(0),
  totalSeconds: z.number().int().min(0),
  activeDays: z.array(z.string()),
  longestStreakDays: z.number().int().min(0),
  artists: z.record(z.string(), artistSchema),
});

const guildSchema = z.object({
  trackCount: z.number().int().min(0),
  totalSeconds: z.number().int().min(0),
  tracks: z.record(z.string(), trackSchema),
  artists: z.record(z.string(), artistSchema),
  requesters: z.record(z.string(), requesterSchema),
  users: z.record(z.string(), userSchema),
});

const fileSchema = z.object({
  version: z.literal(1),
  guilds: z.record(z.string(), guildSchema),
});

type StoredFile = z.infer<typeof fileSchema>;
type StoredGuild = StoredFile['guilds'][string];
type StoredUser = StoredGuild['users'][string];

const createEmptyFile = (): StoredFile => ({
  version: 1,
  guilds: {},
});

const writeJsonAtomic = async (
  filePath: string,
  payload: StoredFile,
): Promise<void> => {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8',
  );
  await rename(temporaryPath, filePath);
};

const normalizeKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);

const getTrackSeconds = (track: Track): number => {
  const raw = track.duration;
  if (!raw || raw === 'LIVE') {
    return 0;
  }

  const parts = raw.split(':').map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => !Number.isFinite(part))) {
    return 0;
  }

  return parts.reduce((total, part) => total * 60 + part, 0);
};

const toDayKey = (date: Date): string => date.toISOString().slice(0, 10);

const previousDayKey = (dayKey: string): string => {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return toDayKey(date);
};

const calculateCurrentStreak = (activeDays: string[]): number => {
  const days = new Set(activeDays);
  let cursor = toDayKey(new Date());
  let streak = 0;

  while (days.has(cursor)) {
    streak += 1;
    cursor = previousDayKey(cursor);
  }

  return streak;
};

const calculateLongestStreak = (activeDays: string[]): number => {
  const sorted = [...new Set(activeDays)].sort();
  let longest = 0;
  let current = 0;
  let previous: string | null = null;

  for (const day of sorted) {
    current = previous && previousDayKey(day) === previous ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = day;
  }

  return longest;
};

const formatArtistName = (track: Track): string =>
  track.author?.trim() || 'Unknown Artist';

const createGuild = (): StoredGuild => ({
  trackCount: 0,
  totalSeconds: 0,
  tracks: {},
  artists: {},
  requesters: {},
  users: {},
});

const createUser = (): StoredUser => ({
  trackCount: 0,
  totalSeconds: 0,
  activeDays: [],
  longestStreakDays: 0,
  artists: {},
});

const sortByPlays = <T extends { plays: number; totalSeconds: number }>(
  left: T,
  right: T,
): number => right.plays - left.plays || right.totalSeconds - left.totalSeconds;

class JsonMusicStatsService implements MusicStatsService {
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
      const parsed = fileSchema.safeParse(JSON.parse(raw) as unknown);

      if (!parsed.success) {
        throw new Error(
          `Music stats file is invalid: ${parsed.error.issues
            .map((issue) => issue.message)
            .join(', ')}`,
        );
      }

      this.data = parsed.data;
      this.logger.debug('Loaded music stats from disk.');
    } catch (error) {
      const isMissingFile =
        error instanceof Error && 'code' in error && error.code === 'ENOENT';

      if (!isMissingFile) {
        throw error;
      }

      this.data = createEmptyFile();
      await writeJsonAtomic(this.filePath, this.data);
      this.logger.info(`Created music stats store at ${this.filePath}.`);
    }
  }

  async recordTrackStart(guildId: string, track: Track): Promise<void> {
    const guild = this.getOrCreateGuild(guildId);
    const requesterId = track.requestedBy?.id ?? 'unknown';
    const seconds = getTrackSeconds(track);
    const artistName = formatArtistName(track);
    const trackKey = normalizeKey(track.url || track.title);
    const artistKey = normalizeKey(artistName);
    const dayKey = toDayKey(new Date());

    guild.trackCount += 1;
    guild.totalSeconds += seconds;

    const storedTrack = (guild.tracks[trackKey] ??= {
      title: track.title,
      url: track.url,
      author: artistName,
      plays: 0,
      totalSeconds: 0,
    });
    storedTrack.title = track.title;
    storedTrack.url = track.url;
    storedTrack.author = artistName;
    storedTrack.plays += 1;
    storedTrack.totalSeconds += seconds;

    const artist = (guild.artists[artistKey] ??= {
      name: artistName,
      plays: 0,
      totalSeconds: 0,
    });
    artist.name = artistName;
    artist.plays += 1;
    artist.totalSeconds += seconds;

    const requester = (guild.requesters[requesterId] ??= {
      userId: requesterId,
      plays: 0,
      totalSeconds: 0,
    });
    requester.plays += 1;
    requester.totalSeconds += seconds;

    const user = (guild.users[requesterId] ??= createUser());
    user.trackCount += 1;
    user.totalSeconds += seconds;
    if (!user.activeDays.includes(dayKey)) {
      user.activeDays.push(dayKey);
      user.activeDays = user.activeDays.sort().slice(-366);
    }
    user.longestStreakDays = Math.max(
      user.longestStreakDays,
      calculateLongestStreak(user.activeDays),
    );

    const userArtist = (user.artists[artistKey] ??= {
      name: artistName,
      plays: 0,
      totalSeconds: 0,
    });
    userArtist.name = artistName;
    userArtist.plays += 1;
    userArtist.totalSeconds += seconds;

    await this.persist();
  }

  getServerStats(guildId: string): MusicStatsSnapshot {
    const guild = this.getOrCreateGuild(guildId);

    return {
      guildId,
      trackCount: guild.trackCount,
      totalSeconds: guild.totalSeconds,
      requesterCount: Object.keys(guild.requesters).length,
      topTrack: this.getTopTracks(guildId, 1)[0],
      topArtist: this.getTopArtists(guildId, 1)[0],
      topRequester: Object.values(guild.requesters).sort(sortByPlays)[0],
    };
  }

  getUserStats(guildId: string, userId: string): MusicUserStatsSnapshot {
    const user = this.getOrCreateGuild(guildId).users[userId] ?? createUser();
    const currentStreakDays = calculateCurrentStreak(user.activeDays);
    const favoriteArtist = Object.values(user.artists).sort(sortByPlays)[0];
    const badges: string[] = [];

    if (user.trackCount >= 100) {
      badges.push('Centurion DJ');
    }

    if (currentStreakDays >= 7) {
      badges.push('Weeklong Listener');
    }

    if (favoriteArtist && favoriteArtist.plays >= 10) {
      badges.push(`${favoriteArtist.name} Regular`);
    }

    return {
      userId,
      trackCount: user.trackCount,
      totalSeconds: user.totalSeconds,
      favoriteArtist,
      currentStreakDays,
      longestStreakDays: user.longestStreakDays,
      badges,
    };
  }

  getTopTracks(guildId: string, limit: number): MusicTrackStat[] {
    return Object.values(this.getOrCreateGuild(guildId).tracks)
      .sort(sortByPlays)
      .slice(0, limit)
      .map((track) => ({ ...track }));
  }

  getTopArtists(guildId: string, limit: number): MusicArtistStat[] {
    return Object.values(this.getOrCreateGuild(guildId).artists)
      .sort(sortByPlays)
      .slice(0, limit)
      .map((artist) => ({ ...artist }));
  }

  private getOrCreateGuild(guildId: string): StoredGuild {
    this.data.guilds[guildId] ??= createGuild();
    return this.data.guilds[guildId];
  }

  private async persist(): Promise<void> {
    const snapshot: StoredFile = JSON.parse(
      JSON.stringify(this.data),
    ) as StoredFile;
    this.writeChain = this.writeChain.then(() =>
      writeJsonAtomic(this.filePath, snapshot),
    );

    await this.writeChain;
  }
}

export const createJsonMusicStatsService = async (
  filePath: string,
  logger: Logger,
): Promise<MusicStatsService> => {
  const service = new JsonMusicStatsService(filePath, logger);
  await service.initialize();
  return service;
};

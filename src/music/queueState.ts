import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { QueueRepeatMode, type Track } from 'discord-player';
import { z } from 'zod';

import type { SavedTrack } from './library';
import type { GuildMusicSession } from '../types/bot';
import type { Logger } from '../utils/logger';

export const DEFAULT_MUSIC_QUEUE_STATE_FILE = 'data/music-queue-state.json';
export const DEFAULT_MUSIC_QUEUE_RESTORE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface PersistedQueueState {
  guildId: string;
  textChannelId: string;
  voiceChannelId: string;
  currentTrack: SavedTrack | null;
  upcomingTracks: SavedTrack[];
  volume: number;
  repeatMode: number;
  panelMessage?: PersistedPanelMessageRef;
  updatedAt: string;
}

export interface PersistedPanelMessageRef {
  channelId: string;
  messageId: string;
}

export interface QueueStateService {
  getAll(): PersistedQueueState[];
  get(guildId: string): PersistedQueueState | null;
  save(
    state: PersistedQueueState,
    options?: { preservePanelMessage?: boolean },
  ): Promise<void>;
  clear(guildId: string): Promise<void>;
}

interface QueueStateServiceOptions {
  restoreMaxAgeMs?: number;
  now?: () => Date;
}

const savedTrackSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  duration: z.string().min(1),
  author: z.string(),
  addedById: z.string().min(1),
  addedAt: z.string().datetime(),
});

const stateSchema = z.object({
  guildId: z.string().min(1),
  textChannelId: z.string().min(1),
  voiceChannelId: z.string().min(1),
  currentTrack: savedTrackSchema.nullable(),
  upcomingTracks: z.array(savedTrackSchema),
  volume: z.number().int().min(1).max(100),
  repeatMode: z
    .number()
    .int()
    .min(QueueRepeatMode.OFF)
    .max(QueueRepeatMode.AUTOPLAY),
  panelMessage: z
    .object({
      channelId: z.string().min(1),
      messageId: z.string().min(1),
    })
    .optional(),
  updatedAt: z.string().datetime(),
});

const fileSchema = z.object({
  version: z.literal(1),
  guilds: z.record(z.string(), stateSchema),
});

type StoredFile = z.infer<typeof fileSchema>;

const createEmptyFile = (): StoredFile => ({
  version: 1,
  guilds: {},
});

const cloneTrack = (track: SavedTrack): SavedTrack => ({ ...track });
const clonePanelMessage = (
  panelMessage: PersistedPanelMessageRef,
): PersistedPanelMessageRef => ({ ...panelMessage });
const cloneState = (state: PersistedQueueState): PersistedQueueState => {
  const cloned: PersistedQueueState = {
    ...state,
    currentTrack: state.currentTrack ? cloneTrack(state.currentTrack) : null,
    upcomingTracks: state.upcomingTracks.map(cloneTrack),
  };

  if (state.panelMessage) {
    cloned.panelMessage = clonePanelMessage(state.panelMessage);
  } else {
    delete cloned.panelMessage;
  }

  return cloned;
};

const isStateFreshEnough = (
  state: PersistedQueueState,
  restoreMaxAgeMs: number,
  now: Date,
): boolean => now.getTime() - Date.parse(state.updatedAt) <= restoreMaxAgeMs;

const writeJsonAtomic = async (
  filePath: string,
  payload: StoredFile,
): Promise<void> => {
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;

  await writeFile(temporaryPath, serialized, 'utf8');
  await rename(temporaryPath, filePath);
};

export const createSavedQueueTrack = (
  track: Track,
  fallbackUserId: string,
): SavedTrack => ({
  title: track.title,
  url: track.url,
  duration: track.duration,
  author: track.author,
  addedById: track.requestedBy?.id ?? fallbackUserId,
  addedAt: new Date().toISOString(),
});

export const createQueueSnapshot = (
  queue: GuildMusicSession,
): PersistedQueueState | null => {
  const textChannelId = queue.metadata?.textChannel.id;
  const voiceChannelId = queue.channel?.id;

  if (!textChannelId || !voiceChannelId) {
    return null;
  }

  const fallbackUserId =
    queue.metadata?.requestedById ??
    queue.guild.members.me?.id ??
    queue.guild.client.user.id;

  return {
    guildId: queue.guild.id,
    textChannelId,
    voiceChannelId,
    currentTrack: queue.currentTrack
      ? createSavedQueueTrack(queue.currentTrack, fallbackUserId)
      : null,
    upcomingTracks: queue.tracks
      .toArray()
      .map((track) => createSavedQueueTrack(track, fallbackUserId)),
    volume: queue.node.volume,
    repeatMode: queue.repeatMode,
    updatedAt: new Date().toISOString(),
  };
};

class JsonQueueStateService implements QueueStateService {
  private states = new Map<string, PersistedQueueState>();
  private writeChain = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly logger: Logger,
    private readonly options: QueueStateServiceOptions = {},
  ) {}

  async initialize(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });

    try {
      const raw = await readFile(this.filePath, 'utf8');
      let parsedJson: unknown;

      try {
        parsedJson = JSON.parse(raw) as unknown;
      } catch (error) {
        throw new Error('Music queue state file contains invalid JSON.', {
          cause: error,
        });
      }

      const parsed = fileSchema.safeParse(parsedJson);

      if (!parsed.success) {
        throw new Error(
          `Music queue state file is invalid: ${parsed.error.issues
            .map((issue) => issue.message)
            .join(', ')}`,
        );
      }

      const restoreMaxAgeMs =
        this.options.restoreMaxAgeMs ?? DEFAULT_MUSIC_QUEUE_RESTORE_MAX_AGE_MS;
      const now = this.options.now?.() ?? new Date();
      const freshStates = Object.entries(parsed.data.guilds).filter(
        ([, state]) => isStateFreshEnough(state, restoreMaxAgeMs, now),
      );
      const staleCount =
        Object.keys(parsed.data.guilds).length - freshStates.length;

      this.states = new Map(freshStates);

      if (staleCount > 0) {
        await this.persist();
        this.logger.info(
          `Pruned ${staleCount} stale persisted queue state(s) older than ${restoreMaxAgeMs} ms.`,
        );
      }

      this.logger.debug(
        `Loaded ${this.states.size} persisted queue state(s) from disk.`,
      );
    } catch (error) {
      const isMissingFile =
        error instanceof Error && 'code' in error && error.code === 'ENOENT';

      if (!isMissingFile) {
        throw error;
      }

      await writeJsonAtomic(this.filePath, createEmptyFile());
      this.logger.info(`Created queue state store at ${this.filePath}.`);
    }
  }

  getAll(): PersistedQueueState[] {
    return [...this.states.values()].map(cloneState);
  }

  get(guildId: string): PersistedQueueState | null {
    const state = this.states.get(guildId);
    return state ? cloneState(state) : null;
  }

  async save(
    state: PersistedQueueState,
    options: { preservePanelMessage?: boolean } = {},
  ): Promise<void> {
    const existingPanelMessage = this.states.get(state.guildId)?.panelMessage;
    const nextState = cloneState(state);

    if (
      options.preservePanelMessage !== false &&
      !nextState.panelMessage &&
      existingPanelMessage
    ) {
      nextState.panelMessage = clonePanelMessage(existingPanelMessage);
    }

    this.states.set(state.guildId, nextState);
    await this.persist();
  }

  async clear(guildId: string): Promise<void> {
    if (!this.states.delete(guildId)) {
      return;
    }

    await this.persist();
  }

  private async persist(): Promise<void> {
    const snapshot: StoredFile = {
      version: 1,
      guilds: Object.fromEntries(
        [...this.states.entries()].map(([guildId, state]) => [
          guildId,
          cloneState(state),
        ]),
      ),
    };

    this.writeChain = this.writeChain.then(() =>
      writeJsonAtomic(this.filePath, snapshot),
    );

    await this.writeChain;
  }
}

export const createJsonQueueStateService = async (
  filePath: string,
  logger: Logger,
  options: QueueStateServiceOptions = {},
): Promise<QueueStateService> => {
  const service = new JsonQueueStateService(filePath, logger, options);
  await service.initialize();
  return service;
};

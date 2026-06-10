import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';

import type { Logger } from '../utils/logger';
import { ValorantError, type ValorantLeaderboardSnapshot } from './types';

export const DEFAULT_VALORANT_LEADERBOARD_STATE_FILE =
  'data/valorant-leaderboard.json';

export interface ValorantLeaderboardMessageState {
  channelId: string;
  messageId: string;
  updatedAt: string;
  snapshots: Record<string, ValorantLeaderboardSnapshot>;
}

export interface ValorantLeaderboardStateStore {
  getState(channelId: string): ValorantLeaderboardMessageState | null;
  setState(state: ValorantLeaderboardMessageState): Promise<void>;
  deleteState(channelId: string): Promise<boolean>;
}

const stateSchema = z.object({
  channelId: z.string().min(1),
  messageId: z.string().min(1),
  updatedAt: z.string().datetime(),
  snapshots: z
    .record(
      z.string(),
      z.object({
        discordUserId: z.string().min(1),
        name: z.string().min(1),
        tag: z.string().min(1),
        region: z.enum(['na', 'eu', 'ap', 'kr', 'latam', 'br']),
        platform: z.enum(['pc', 'console']),
        rank: z.string().min(1),
        rr: z.number().optional(),
        elo: z.number().optional(),
        leaderboardPosition: z.number().int().positive(),
      }),
    )
    .optional()
    .default({}),
});

const fileSchema = z.object({
  version: z.literal(1),
  channels: z.record(z.string(), stateSchema),
});

type StoredFile = z.infer<typeof fileSchema>;

const createEmptyFile = (): StoredFile => ({
  version: 1,
  channels: {},
});

const cloneSnapshots = (
  snapshots: Record<string, ValorantLeaderboardSnapshot>,
): Record<string, ValorantLeaderboardSnapshot> =>
  Object.fromEntries(
    Object.entries(snapshots).map(([key, value]) => [key, { ...value }]),
  );

const cloneState = (
  state: ValorantLeaderboardMessageState,
): ValorantLeaderboardMessageState => ({
  ...state,
  snapshots: cloneSnapshots(state.snapshots),
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

class JsonValorantLeaderboardStateStore implements ValorantLeaderboardStateStore {
  private readonly channels = new Map<
    string,
    ValorantLeaderboardMessageState
  >();
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
        throw new ValorantError(
          'config',
          'Valorant leaderboard state file contains invalid JSON.',
          { cause: error },
        );
      }

      const parsed = fileSchema.safeParse(parsedJson);

      if (!parsed.success) {
        throw new ValorantError(
          'config',
          `Valorant leaderboard state file is invalid: ${parsed.error.issues
            .map((issue) => issue.message)
            .join(', ')}`,
        );
      }

      this.channels.clear();

      for (const state of Object.values(parsed.data.channels)) {
        this.channels.set(state.channelId, state);
      }

      this.logger.debug(
        `Loaded ${this.channels.size} Valorant leaderboard state record(s).`,
      );
    } catch (error) {
      const isMissingFile =
        error instanceof Error && 'code' in error && error.code === 'ENOENT';

      if (!isMissingFile) {
        throw error;
      }

      await writeJsonAtomic(this.filePath, createEmptyFile());
      this.logger.info(
        `Created Valorant leaderboard state store at ${this.filePath}.`,
      );
    }
  }

  getState(channelId: string): ValorantLeaderboardMessageState | null {
    const state = this.channels.get(channelId);
    return state ? cloneState(state) : null;
  }

  async setState(state: ValorantLeaderboardMessageState): Promise<void> {
    this.channels.set(state.channelId, cloneState(state));
    await this.persist();
  }

  async deleteState(channelId: string): Promise<boolean> {
    const existed = this.channels.delete(channelId);

    if (!existed) {
      return false;
    }

    await this.persist();
    return true;
  }

  private async persist(): Promise<void> {
    const snapshot: StoredFile = {
      version: 1,
      channels: Object.fromEntries(
        [...this.channels.entries()].map(([key, value]) => [
          key,
          cloneState(value),
        ]),
      ),
    };

    this.writeChain = this.writeChain.then(() =>
      writeJsonAtomic(this.filePath, snapshot),
    );

    await this.writeChain;
  }
}

export const createJsonValorantLeaderboardStateStore = async (
  filePath: string,
  logger: Logger,
): Promise<ValorantLeaderboardStateStore> => {
  const store = new JsonValorantLeaderboardStateStore(filePath, logger);
  await store.initialize();
  return store;
};

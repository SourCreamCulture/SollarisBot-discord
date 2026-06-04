import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';

import type { Logger } from '../utils/logger';
import type { ApexResolvedTarget } from './types';

export const DEFAULT_APEX_WATCH_FILE = 'data/apex-watch.json';

export interface ApexWatchSnapshot {
  discordUserId: string;
  target: ApexResolvedTarget;
  stats: Record<string, number>;
  capturedAt: string;
}

export interface ApexWatchStore {
  getSnapshot(discordUserId: string): ApexWatchSnapshot | null;
  setSnapshot(snapshot: ApexWatchSnapshot): Promise<void>;
}

const targetSchema = z.object({
  source: z.enum(['manual', 'member', 'self']),
  discordUserId: z.string().optional(),
  appPlatform: z.enum(['pc', 'playstation', 'xbox']),
  providerPlatform: z.enum(['origin', 'psn', 'xbl']),
  username: z.string(),
  uid: z.string().optional(),
  displayName: z.string(),
});

const snapshotSchema = z.object({
  discordUserId: z.string(),
  target: targetSchema,
  stats: z.record(z.string(), z.number()),
  capturedAt: z.string().datetime(),
});

const fileSchema = z.object({
  version: z.literal(1),
  snapshots: z.record(z.string(), snapshotSchema),
});

type StoredFile = z.infer<typeof fileSchema>;

const createEmptyFile = (): StoredFile => ({
  version: 1,
  snapshots: {},
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

const cloneSnapshot = (snapshot: ApexWatchSnapshot): ApexWatchSnapshot => ({
  ...snapshot,
  target: { ...snapshot.target },
  stats: { ...snapshot.stats },
});

class JsonApexWatchStore implements ApexWatchStore {
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
          `Apex watch file is invalid: ${parsed.error.issues
            .map((issue) => issue.message)
            .join(', ')}`,
        );
      }

      this.data = parsed.data;
      this.logger.debug('Loaded Apex watch snapshots from disk.');
    } catch (error) {
      const isMissingFile =
        error instanceof Error && 'code' in error && error.code === 'ENOENT';

      if (!isMissingFile) {
        throw error;
      }

      this.data = createEmptyFile();
      await writeJsonAtomic(this.filePath, this.data);
      this.logger.info(`Created Apex watch store at ${this.filePath}.`);
    }
  }

  getSnapshot(discordUserId: string): ApexWatchSnapshot | null {
    const snapshot = this.data.snapshots[discordUserId];
    return snapshot ? cloneSnapshot(snapshot) : null;
  }

  async setSnapshot(snapshot: ApexWatchSnapshot): Promise<void> {
    this.data.snapshots[snapshot.discordUserId] = cloneSnapshot(snapshot);
    await this.persist();
  }

  private async persist(): Promise<void> {
    const snapshot: StoredFile = {
      version: 1,
      snapshots: Object.fromEntries(
        Object.entries(this.data.snapshots).map(([id, stored]) => [
          id,
          cloneSnapshot(stored),
        ]),
      ),
    };

    this.writeChain = this.writeChain.then(() =>
      writeJsonAtomic(this.filePath, snapshot),
    );

    await this.writeChain;
  }
}

export const createJsonApexWatchStore = async (
  filePath: string,
  logger: Logger,
): Promise<ApexWatchStore> => {
  const store = new JsonApexWatchStore(filePath, logger);
  await store.initialize();
  return store;
};

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';

import type { Logger } from '../utils/logger';
import { ApexError, type ApexLinkedAccount, type ApexLinkStore } from './types';

const linkSchema = z.object({
  discordUserId: z.string().min(1),
  appPlatform: z.enum(['pc', 'playstation', 'xbox']),
  providerPlatform: z.enum(['origin', 'psn', 'xbl']),
  username: z.string().min(1),
  uid: z.string().min(1).optional(),
  displayName: z.string().min(1),
  linkedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const fileSchema = z.object({
  version: z.literal(1),
  links: z.record(z.string(), linkSchema),
});

type StoredFile = z.infer<typeof fileSchema>;

const createEmptyFile = (): StoredFile => ({
  version: 1,
  links: {},
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

class JsonApexLinkStore implements ApexLinkStore {
  private readonly links = new Map<string, ApexLinkedAccount>();
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
        throw new ApexError(
          'config',
          'Apex link storage file contains invalid JSON.',
          {
            cause: error,
          },
        );
      }

      const parsed = fileSchema.safeParse(parsedJson);

      if (!parsed.success) {
        throw new ApexError(
          'config',
          `Apex link storage file is invalid: ${parsed.error.issues
            .map((issue) => issue.message)
            .join(', ')}`,
        );
      }

      this.links.clear();

      for (const link of Object.values(parsed.data.links)) {
        this.links.set(link.discordUserId, link);
      }

      this.logger.debug(
        `Loaded ${this.links.size} linked Apex account(s) from disk.`,
      );
    } catch (error) {
      const isMissingFile =
        error instanceof Error && 'code' in error && error.code === 'ENOENT';

      if (!isMissingFile) {
        throw error;
      }

      await writeJsonAtomic(this.filePath, createEmptyFile());
      this.logger.info(`Created Apex link store at ${this.filePath}.`);
    }
  }

  getLink(discordUserId: string): ApexLinkedAccount | null {
    const link = this.links.get(discordUserId);
    return link ? { ...link } : null;
  }

  async setLink(link: ApexLinkedAccount): Promise<void> {
    this.links.set(link.discordUserId, { ...link });
    await this.persist();
  }

  async deleteLink(discordUserId: string): Promise<boolean> {
    const existed = this.links.delete(discordUserId);

    if (!existed) {
      return false;
    }

    await this.persist();
    return true;
  }

  private async persist(): Promise<void> {
    const snapshot: StoredFile = {
      version: 1,
      links: Object.fromEntries(
        [...this.links.entries()].map(([key, value]) => [key, { ...value }]),
      ),
    };

    this.writeChain = this.writeChain.then(() =>
      writeJsonAtomic(this.filePath, snapshot),
    );

    await this.writeChain;
  }
}

export const createJsonApexLinkStore = async (
  filePath: string,
  logger: Logger,
): Promise<ApexLinkStore> => {
  const store = new JsonApexLinkStore(filePath, logger);
  await store.initialize();
  return store;
};

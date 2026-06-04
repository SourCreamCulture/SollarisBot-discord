import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';

import type { BotConfig } from '../types/bot';
import type { Logger } from '../utils/logger';

export const DEFAULT_MUSIC_SETTINGS_FILE = 'data/music-settings.json';

export interface GuildMusicSettings {
  guildId: string;
  defaultVolume: number;
  djRoleId: string | null;
  textChannelId: string | null;
  twentyFourSevenEnabled: boolean;
  voteSkipEnabled: boolean;
  voteSkipThreshold: number;
  updatedAt: string;
}

export interface MusicSettingsService {
  getSettings(guildId: string): GuildMusicSettings;
  setDefaultVolume(
    guildId: string,
    volume: number,
  ): Promise<GuildMusicSettings>;
  setDjRole(
    guildId: string,
    roleId: string | null,
  ): Promise<GuildMusicSettings>;
  setTextChannel(
    guildId: string,
    channelId: string | null,
  ): Promise<GuildMusicSettings>;
  setTwentyFourSevenEnabled(
    guildId: string,
    enabled: boolean,
  ): Promise<GuildMusicSettings>;
  setVoteSkipEnabled(
    guildId: string,
    enabled: boolean,
  ): Promise<GuildMusicSettings>;
  setVoteSkipThreshold(
    guildId: string,
    threshold: number,
  ): Promise<GuildMusicSettings>;
}

const settingsSchema = z.object({
  guildId: z.string().min(1),
  defaultVolume: z.number().int().min(1).max(100),
  djRoleId: z.string().min(1).nullable().default(null),
  textChannelId: z.string().min(1).nullable().default(null),
  twentyFourSevenEnabled: z.boolean().default(false),
  voteSkipEnabled: z.boolean().default(true),
  voteSkipThreshold: z.number().min(0.1).max(1).default(0.5),
  updatedAt: z.string().datetime(),
});

const fileSchema = z.object({
  version: z.literal(1),
  guilds: z.record(z.string(), settingsSchema),
});

type StoredFile = z.infer<typeof fileSchema>;

const createEmptyFile = (): StoredFile => ({
  version: 1,
  guilds: {},
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

class JsonMusicSettingsService implements MusicSettingsService {
  private readonly guilds = new Map<string, GuildMusicSettings>();
  private writeChain = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly config: BotConfig,
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
        throw new Error('Music settings file contains invalid JSON.', {
          cause: error,
        });
      }

      const parsed = fileSchema.safeParse(parsedJson);

      if (!parsed.success) {
        throw new Error(
          `Music settings file is invalid: ${parsed.error.issues
            .map((issue) => issue.message)
            .join(', ')}`,
        );
      }

      this.guilds.clear();

      for (const settings of Object.values(parsed.data.guilds)) {
        this.guilds.set(settings.guildId, settings);
      }

      this.logger.debug(
        `Loaded ${this.guilds.size} music settings record(s) from disk.`,
      );
    } catch (error) {
      const isMissingFile =
        error instanceof Error && 'code' in error && error.code === 'ENOENT';

      if (!isMissingFile) {
        throw error;
      }

      await writeJsonAtomic(this.filePath, createEmptyFile());
      this.logger.info(`Created music settings store at ${this.filePath}.`);
    }
  }

  getSettings(guildId: string): GuildMusicSettings {
    return {
      ...this.getOrCreateSettings(guildId),
    };
  }

  async setDefaultVolume(
    guildId: string,
    volume: number,
  ): Promise<GuildMusicSettings> {
    return this.update(guildId, { defaultVolume: volume });
  }

  async setDjRole(
    guildId: string,
    roleId: string | null,
  ): Promise<GuildMusicSettings> {
    return this.update(guildId, { djRoleId: roleId });
  }

  async setTextChannel(
    guildId: string,
    channelId: string | null,
  ): Promise<GuildMusicSettings> {
    return this.update(guildId, { textChannelId: channelId });
  }

  async setTwentyFourSevenEnabled(
    guildId: string,
    enabled: boolean,
  ): Promise<GuildMusicSettings> {
    return this.update(guildId, { twentyFourSevenEnabled: enabled });
  }

  async setVoteSkipEnabled(
    guildId: string,
    enabled: boolean,
  ): Promise<GuildMusicSettings> {
    return this.update(guildId, { voteSkipEnabled: enabled });
  }

  async setVoteSkipThreshold(
    guildId: string,
    threshold: number,
  ): Promise<GuildMusicSettings> {
    return this.update(guildId, { voteSkipThreshold: threshold });
  }

  private getOrCreateSettings(guildId: string): GuildMusicSettings {
    const existing = this.guilds.get(guildId);

    if (existing) {
      return existing;
    }

    const created: GuildMusicSettings = {
      guildId,
      defaultVolume: this.config.music.defaultVolume,
      djRoleId: null,
      textChannelId: null,
      twentyFourSevenEnabled: false,
      voteSkipEnabled: true,
      voteSkipThreshold: this.config.music.voteSkipThreshold,
      updatedAt: new Date().toISOString(),
    };

    this.guilds.set(guildId, created);
    return created;
  }

  private async update(
    guildId: string,
    patch: Partial<Omit<GuildMusicSettings, 'guildId' | 'updatedAt'>>,
  ): Promise<GuildMusicSettings> {
    const next: GuildMusicSettings = {
      ...this.getOrCreateSettings(guildId),
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    this.guilds.set(guildId, next);
    await this.persist();
    return { ...next };
  }

  private async persist(): Promise<void> {
    const snapshot: StoredFile = {
      version: 1,
      guilds: Object.fromEntries(
        [...this.guilds.entries()].map(([guildId, settings]) => [
          guildId,
          { ...settings },
        ]),
      ),
    };

    this.writeChain = this.writeChain.then(() =>
      writeJsonAtomic(this.filePath, snapshot),
    );

    await this.writeChain;
  }
}

export const createJsonMusicSettingsService = async (
  filePath: string,
  config: BotConfig,
  logger: Logger,
): Promise<MusicSettingsService> => {
  const service = new JsonMusicSettingsService(filePath, config, logger);
  await service.initialize();
  return service;
};

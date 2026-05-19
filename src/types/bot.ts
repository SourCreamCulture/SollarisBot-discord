import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  ColorResolvable,
  GuildMember,
  GuildTextBasedChannel,
  VoiceBasedChannel,
} from 'discord.js';
import type {
  GuildQueue,
  Player,
  SearchQueryType,
  SearchResult,
  Track,
} from 'discord-player';
import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord-api-types/v10';
import type { ApexService, ApexStatsProvider } from '../apex/types';
import type { MusicLibraryService } from '../music/library';
import type { QueueStateService } from '../music/queueState';
import type { MusicSettingsService } from '../music/settings';
import type { VoteSkipManager } from '../music/voteSkip';

import type { Logger } from "../utils/logger";

export interface BotConfig {
  discordToken: string;
  discordClientId: string;
  discordGuildId?: string;
  logLevel: LogLevel;
  apex: {
    provider: ApexStatsProvider;
    trackerApiKey?: string;
    mozambiqueApiKey?: string;
    linksFile: string;
  };
  music: {
    defaultVolume: number;
    settingsFile: string;
    libraryFile: string;
    queueStateFile: string;
    voteSkipThreshold: number;
    leaveOnEmptyCooldownMs: number;
    leaveOnEndCooldownMs: number;
    leaveOnStopCooldownMs: number;
    youtubeSearchEngine: `ext:${string}`;
  };
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface MusicMetadata {
  textChannel: GuildTextBasedChannel;
  requestedById: string;
}

export type GuildMusicSession = GuildQueue<MusicMetadata>;

export interface PlaybackRequest {
  query: string;
  member: GuildMember;
  voiceChannel: VoiceBasedChannel;
  textChannel: GuildTextBasedChannel;
  defaultVolume?: number;
  stayConnected?: boolean;
  searchEngine?: SearchQueryType | `ext:${string}`;
}

export interface PlayResult {
  queue: GuildMusicSession;
  track: Track;
  searchResult: SearchResult;
  startedPlayback: boolean;
}

export interface CommandContext {
  interaction: ChatInputCommandInteraction<'cached'>;
  config: BotConfig;
  logger: Logger;
  player: Player;
  apex: ApexService;
  musicLibrary: MusicLibraryService;
  musicSettings: MusicSettingsService;
  queueState: QueueStateService;
  voteSkips: VoteSkipManager;
  deferReply(options?: { ephemeral?: boolean }): Promise<void>;
  replyError(message: string): Promise<unknown>;
  replyInfo(message: string): Promise<unknown>;
  replySuccess(message: string): Promise<unknown>;
  editReply(options: {
    title: string;
    description: string;
    color?: ColorResolvable;
  }): Promise<unknown>;
}

export interface AutocompleteContext {
  interaction: AutocompleteInteraction<'cached'>;
  config: BotConfig;
  logger: Logger;
  player: Player;
  apex: ApexService;
  musicLibrary: MusicLibraryService;
  musicSettings: MusicSettingsService;
  queueState: QueueStateService;
  voteSkips: VoteSkipManager;
}

export interface CommandModule {
  data: {
    name: string;
    toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody;
  };
  execute(context: CommandContext): Promise<void>;
  autocomplete?(context: AutocompleteContext): Promise<void>;
}

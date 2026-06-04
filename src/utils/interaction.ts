import type {
  ChatInputCommandInteraction,
  ColorResolvable,
  InteractionEditReplyOptions,
  InteractionReplyOptions,
  MessageComponentInteraction,
  ModalSubmitInteraction,
} from 'discord.js';

import type { ApexService } from '../apex/types';
import type { ValorantService } from '../valorant/types';
import type { BotConfig, CommandContext } from '../types/bot';
import type { Logger } from './logger';
import type { Player } from 'discord-player';
import type { AutocompleteContext } from '../types/bot';
import type { MusicLibraryService } from '../music/library';
import type { MusicStatsService } from '../music/stats';
import type { QueueStateService } from '../music/queueState';
import type { MusicSettingsService } from '../music/settings';
import type { QueueVoteManager } from '../music/queueVoting';
import type { VoteSkipManager } from '../music/voteSkip';
import type { UtilityStore } from './utilityStore';
import {
  createErrorReply,
  createInfoReply,
  createStatusEmbed,
  createSuccessReply,
} from './embeds';

type RepliableInteraction =
  | ChatInputCommandInteraction<'cached'>
  | MessageComponentInteraction<'cached'>
  | ModalSubmitInteraction<'cached'>;

const sendResponse = async (
  interaction: RepliableInteraction,
  options: InteractionReplyOptions,
) => {
  if (interaction.deferred) {
    return interaction.editReply(options as InteractionEditReplyOptions);
  }

  if (interaction.replied) {
    return interaction.followUp(options);
  }

  return interaction.reply(options);
};

export const createCommandContext = (
  interaction: ChatInputCommandInteraction<'cached'>,
  player: Player,
  apex: ApexService,
  valorant: ValorantService,
  musicLibrary: MusicLibraryService,
  musicStats: MusicStatsService,
  musicSettings: MusicSettingsService,
  queueState: QueueStateService,
  queueVotes: QueueVoteManager,
  voteSkips: VoteSkipManager,
  utilityStore: UtilityStore,
  config: BotConfig,
  logger: Logger,
): CommandContext => ({
  interaction,
  player,
  apex,
  valorant,
  musicLibrary,
  musicStats,
  musicSettings,
  queueState,
  queueVotes,
  voteSkips,
  utilityStore,
  config,
  logger,
  deferReply: async (options) => {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({
        ephemeral: options?.ephemeral,
      });
    }
  },
  replyError: async (message: string) =>
    sendResponse(
      interaction,
      createErrorReply('Something went wrong', message),
    ),
  replyInfo: async (message: string) =>
    sendResponse(interaction, createInfoReply('Music Update', message)),
  replySuccess: async (message: string) =>
    sendResponse(interaction, createSuccessReply('Music Update', message)),
  editReply: async ({
    title,
    description,
    color,
  }: {
    title: string;
    description: string;
    color?: ColorResolvable;
  }) =>
    interaction.editReply({
      embeds: [createStatusEmbed(title, description, color)],
    }),
});

export const createAutocompleteContext = (
  interaction: AutocompleteContext['interaction'],
  player: Player,
  apex: ApexService,
  valorant: ValorantService,
  musicLibrary: MusicLibraryService,
  musicStats: MusicStatsService,
  musicSettings: MusicSettingsService,
  queueState: QueueStateService,
  queueVotes: QueueVoteManager,
  voteSkips: VoteSkipManager,
  utilityStore: UtilityStore,
  config: BotConfig,
  logger: Logger,
): AutocompleteContext => ({
  interaction,
  player,
  apex,
  valorant,
  musicLibrary,
  musicStats,
  musicSettings,
  queueState,
  queueVotes,
  voteSkips,
  utilityStore,
  config,
  logger,
});

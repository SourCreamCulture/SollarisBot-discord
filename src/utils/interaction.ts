import type {
  ChatInputCommandInteraction,
  ColorResolvable,
  InteractionEditReplyOptions,
  InteractionReplyOptions,
  MessageComponentInteraction,
  ModalSubmitInteraction,
} from 'discord.js';

import type { ApexService } from '../apex/types';
import type { BotConfig, CommandContext } from '../types/bot';
import type { Logger } from './logger';
import type { Player } from 'discord-player';
import type { AutocompleteContext } from '../types/bot';
import type { MusicLibraryService } from '../music/library';
import type { QueueStateService } from '../music/queueState';
import type { MusicSettingsService } from '../music/settings';
import type { VoteSkipManager } from '../music/voteSkip';
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
  musicLibrary: MusicLibraryService,
  musicSettings: MusicSettingsService,
  queueState: QueueStateService,
  voteSkips: VoteSkipManager,
  config: BotConfig,
  logger: Logger,
): CommandContext => ({
  interaction,
  player,
  apex,
  musicLibrary,
  musicSettings,
  queueState,
  voteSkips,
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
  musicLibrary: MusicLibraryService,
  musicSettings: MusicSettingsService,
  queueState: QueueStateService,
  voteSkips: VoteSkipManager,
  config: BotConfig,
  logger: Logger,
): AutocompleteContext => ({
  interaction,
  player,
  apex,
  musicLibrary,
  musicSettings,
  queueState,
  voteSkips,
  config,
  logger,
});

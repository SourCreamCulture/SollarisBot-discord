import {
  EmbedBuilder,
  type ColorResolvable,
  type InteractionReplyOptions,
} from 'discord.js';

const COLORS = {
  info: 0x4f9eed,
  success: 0x53d769,
  error: 0xf44336,
};

export const createStatusEmbed = (
  title: string,
  description: string,
  color: ColorResolvable = COLORS.info,
): EmbedBuilder =>
  new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();

export const createInfoReply = (
  title: string,
  description: string,
): InteractionReplyOptions => ({
  embeds: [createStatusEmbed(title, description, COLORS.info)],
});

export const createSuccessReply = (
  title: string,
  description: string,
): InteractionReplyOptions => ({
  embeds: [createStatusEmbed(title, description, COLORS.success)],
});

export const createErrorReply = (
  title: string,
  description: string,
): InteractionReplyOptions => ({
  embeds: [createStatusEmbed(title, description, COLORS.error)],
  ephemeral: true,
});

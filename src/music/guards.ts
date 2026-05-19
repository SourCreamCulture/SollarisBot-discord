import {
  GuildMember,
  type ChatInputCommandInteraction,
  type GuildTextBasedChannel,
  type VoiceBasedChannel,
} from 'discord.js';

import type { CommandContext, GuildMusicSession, MusicMetadata } from '../types/bot';
import { getGuildSession, updateSessionMetadata } from './service';

export const resolveMember = async (
  interaction: ChatInputCommandInteraction<'cached'>,
): Promise<GuildMember> => {
  if (interaction.member instanceof GuildMember) {
    return interaction.member;
  }

  return interaction.guild.members.fetch(interaction.user.id);
};

export const resolveTextChannel = (
  interaction: ChatInputCommandInteraction<'cached'>,
): GuildTextBasedChannel | null => {
  const channel = interaction.channel;

  if (!channel || !channel.isTextBased()) {
    return null;
  }

  return channel as GuildTextBasedChannel;
};

export const requireVoiceChannel = async (
  context: CommandContext,
): Promise<VoiceBasedChannel | null> => {
  const member = await resolveMember(context.interaction);
  const channel = member.voice.channel;

  if (!channel || !channel.isVoiceBased()) {
    await context.replyError(
      'You need to join a voice channel before using music commands.',
    );
    return null;
  }

  return channel;
};

export const requireGuildSession = async (
  context: CommandContext,
): Promise<GuildMusicSession | null> => {
  const queue = getGuildSession(context.player, context.interaction.guildId);

  if (!queue) {
    await context.replyError('There is no active music session in this server yet.');
    return null;
  }

  return queue;
};

export const ensureSameVoiceChannel = async (
  context: CommandContext,
  queue: GuildMusicSession,
  memberVoiceChannel: VoiceBasedChannel,
): Promise<boolean> => {
  if (queue.channel && queue.channel.id !== memberVoiceChannel.id) {
    await context.replyError(
      `You need to be in ${queue.channel.toString()} with me to use this command.`,
    );
    return false;
  }

  return true;
};

export const requireControllableSession = async (
  context: CommandContext,
): Promise<{ queue: GuildMusicSession; voiceChannel: VoiceBasedChannel } | null> => {
  const voiceChannel = await requireVoiceChannel(context);

  if (!voiceChannel) {
    return null;
  }

  const queue = await requireGuildSession(context);

  if (!queue) {
    return null;
  }

  if (!(await ensureSameVoiceChannel(context, queue, voiceChannel))) {
    return null;
  }

  return { queue, voiceChannel };
};

export const syncQueueTextChannel = (
  interaction: ChatInputCommandInteraction<'cached'>,
  queue: GuildMusicSession,
): void => {
  const textChannel = resolveTextChannel(interaction);

  if (!textChannel) {
    return;
  }

  const metadata: MusicMetadata = {
    textChannel,
    requestedById: interaction.user.id,
  };

  updateSessionMetadata(queue, metadata);
};

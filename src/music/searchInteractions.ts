import type {
  GuildMember,
  GuildTextBasedChannel,
  Interaction,
  StringSelectMenuInteraction,
} from 'discord.js';

import type { BotConfig } from '../types/bot';
import type { Logger } from '../utils/logger';
import type { Player } from 'discord-player';
import type { MusicSettingsService } from './settings';
import { createErrorReply, createSuccessReply } from '../utils/embeds';
import { getGuildSession, playTrack } from './service';

const CUSTOM_ID_PREFIX = 'music-search:';

const isMusicSearchSelect = (
  interaction: Interaction,
): interaction is StringSelectMenuInteraction<'cached'> =>
  interaction.isStringSelectMenu() &&
  interaction.inCachedGuild() &&
  interaction.customId.startsWith(CUSTOM_ID_PREFIX);

const resolveTextChannel = (
  interaction: StringSelectMenuInteraction<'cached'>,
): GuildTextBasedChannel | null => {
  const channel = interaction.channel;

  if (!channel || !channel.isTextBased()) {
    return null;
  }

  return channel as GuildTextBasedChannel;
};

const replyError = async (
  interaction: StringSelectMenuInteraction<'cached'>,
  message: string,
) => {
  if (interaction.deferred || interaction.replied) {
    return interaction.followUp(createErrorReply('Music Error', message));
  }

  return interaction.reply(createErrorReply('Music Error', message));
};

export const handleMusicSearchSelect = async (
  interaction: Interaction,
  player: Player,
  musicSettings: MusicSettingsService,
  config: BotConfig,
  logger: Logger,
): Promise<boolean> => {
  if (!isMusicSearchSelect(interaction)) {
    return false;
  }

  const ownerId = interaction.customId.slice(CUSTOM_ID_PREFIX.length);
  const settings = musicSettings.getSettings(interaction.guildId);

  if (
    settings.textChannelId &&
    settings.textChannelId !== interaction.channelId
  ) {
    await replyError(
      interaction,
      `Music commands are bound to <#${settings.textChannelId}> in this server.`,
    );
    return true;
  }

  if (interaction.user.id !== ownerId) {
    await interaction.reply({
      content: 'Only the person who ran `/search` can choose from this menu.',
      ephemeral: true,
    });
    return true;
  }

  const member = interaction.member;

  if (!(member instanceof Object) || !('voice' in member)) {
    await replyError(
      interaction,
      'I could not resolve your server member data.',
    );
    return true;
  }

  const guildMember = member as GuildMember;
  const voiceChannel = guildMember.voice.channel;
  const textChannel = resolveTextChannel(interaction);

  if (!voiceChannel || !voiceChannel.isVoiceBased()) {
    await replyError(
      interaction,
      'You need to join a voice channel before choosing a search result.',
    );
    return true;
  }

  if (!textChannel) {
    await replyError(
      interaction,
      'I can only manage music from a server text channel.',
    );
    return true;
  }

  const existingQueue = getGuildSession(player, interaction.guildId);

  if (
    existingQueue &&
    existingQueue.channel &&
    existingQueue.channel.id !== voiceChannel.id
  ) {
    await replyError(
      interaction,
      `You need to be in ${existingQueue.channel.toString()} with me to use this menu.`,
    );
    return true;
  }

  await interaction.deferUpdate();

  try {
    await interaction.message.edit({ components: [] });
  } catch (error) {
    logger.warn('Failed to disable a used search select menu.', error);
  }

  const query = interaction.values[0];

  try {
    const result = await playTrack(player, config, {
      query,
      member: guildMember,
      voiceChannel,
      textChannel,
      defaultVolume: settings.defaultVolume,
      stayConnected: settings.twentyFourSevenEnabled,
    });

    const action = result.startedPlayback ? 'Now playing' : 'Queued';

    await interaction.followUp(
      createSuccessReply(
        'Track Loaded',
        `${action} [${result.track.title}](${result.track.url}) • \`${result.track.duration}\``,
      ),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown playback error.';

    logger.error('Failed to play selected search result.', error);
    await interaction.followUp(
      createErrorReply(
        'Music Error',
        `I could not play that search result.\n\`${message}\``,
      ),
    );
  }

  return true;
};

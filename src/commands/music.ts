import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

import type { CommandModule } from '../types/bot';
import { applyMusicSettingsToQueue, getGuildSession } from '../music/service';
import { createQueueSnapshot } from '../music/queueState';

const formatPercent = (threshold: number): string =>
  `${Math.round(threshold * 100)}%`;

export const musicCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('View and manage server-wide music settings.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommandGroup((group) =>
      group
        .setName('settings')
        .setDescription(
          'View and manage persistent music settings for this server.',
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('view')
            .setDescription('Show current music settings.'),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('default-volume')
            .setDescription('Set the default volume for new music sessions.')
            .addIntegerOption((option) =>
              option
                .setName('percent')
                .setDescription('A default volume from 1 to 100')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('dj-role')
            .setDescription('Require a role for playback control commands.')
            .addRoleOption((option) =>
              option
                .setName('role')
                .setDescription('The DJ role to require')
                .setRequired(true),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('clear-dj-role')
            .setDescription(
              'Allow everyone in voice to use playback controls.',
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('bind-channel')
            .setDescription('Restrict music commands to one text channel.')
            .addChannelOption((option) =>
              option
                .setName('channel')
                .setDescription('The text channel for music commands')
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('unbind-channel')
            .setDescription('Allow music commands in any text channel.'),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('twenty-four-seven')
            .setDescription('Keep the bot connected when the queue ends.')
            .addBooleanOption((option) =>
              option
                .setName('enabled')
                .setDescription('Whether 24/7 mode should be enabled')
                .setRequired(true),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('voteskip')
            .setDescription('Turn shared vote skip on or off.')
            .addBooleanOption((option) =>
              option
                .setName('enabled')
                .setDescription('Whether vote skip should be enabled')
                .setRequired(true),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('voteskip-threshold')
            .setDescription('Set the percent of listeners needed to vote skip.')
            .addIntegerOption((option) =>
              option
                .setName('percent')
                .setDescription('A threshold from 10 to 100 percent')
                .setRequired(true)
                .setMinValue(10)
                .setMaxValue(100),
            ),
        ),
    ),
  execute: async (context) => {
    const group = context.interaction.options.getSubcommandGroup(true);
    const subcommand = context.interaction.options.getSubcommand(true);
    const guildId = context.interaction.guildId;

    if (group !== 'settings') {
      await context.replyError('That music command group is not available.');
      return;
    }

    switch (subcommand) {
      case 'default-volume': {
        const volume = context.interaction.options.getInteger('percent', true);
        const settings = await context.musicSettings.setDefaultVolume(
          guildId,
          volume,
        );
        await context.replySuccess(
          `Default music volume is now **${settings.defaultVolume}%**.`,
        );
        return;
      }
      case 'dj-role': {
        const role = context.interaction.options.getRole('role', true);
        await context.musicSettings.setDjRole(guildId, role.id);
        await context.replySuccess(
          `DJ controls now require the ${role.toString()} role.`,
        );
        return;
      }
      case 'clear-dj-role': {
        await context.musicSettings.setDjRole(guildId, null);
        await context.replySuccess('DJ role restriction has been removed.');
        return;
      }
      case 'bind-channel': {
        const channel = context.interaction.options.getChannel('channel', true);
        await context.musicSettings.setTextChannel(guildId, channel.id);
        await context.replySuccess(
          `Music commands are now bound to ${channel.toString()}.`,
        );
        return;
      }
      case 'unbind-channel': {
        await context.musicSettings.setTextChannel(guildId, null);
        await context.replySuccess(
          'Music commands can now be used in any text channel.',
        );
        return;
      }
      case 'voteskip': {
        const enabled = context.interaction.options.getBoolean('enabled', true);
        await context.musicSettings.setVoteSkipEnabled(guildId, enabled);
        await context.replySuccess(
          `Vote skip is now **${enabled ? 'enabled' : 'disabled'}**.`,
        );
        return;
      }
      case 'twenty-four-seven': {
        const enabled = context.interaction.options.getBoolean('enabled', true);
        const settings = await context.musicSettings.setTwentyFourSevenEnabled(
          guildId,
          enabled,
        );
        const queue = getGuildSession(context.player, guildId);

        if (queue) {
          applyMusicSettingsToQueue(queue, context.config, settings);
          const snapshot = createQueueSnapshot(queue);
          if (snapshot) {
            if (
              enabled ||
              snapshot.currentTrack ||
              snapshot.upcomingTracks.length > 0
            ) {
              await context.queueState.save(snapshot);
            } else {
              await context.queueState.clear(guildId);
            }
          }
        }

        await context.replySuccess(
          `24/7 mode is now **${enabled ? 'enabled' : 'disabled'}**.`,
        );
        return;
      }
      case 'voteskip-threshold': {
        const percent = context.interaction.options.getInteger('percent', true);
        const settings = await context.musicSettings.setVoteSkipThreshold(
          guildId,
          percent / 100,
        );
        await context.replySuccess(
          `Vote skip threshold is now **${formatPercent(
            settings.voteSkipThreshold,
          )}**.`,
        );
        return;
      }
      case 'view':
      default: {
        const settings = context.musicSettings.getSettings(guildId);
        const embed = new EmbedBuilder()
          .setColor(0x4f9eed)
          .setTitle('Music Settings')
          .addFields(
            {
              name: 'Default Volume',
              value: `\`${settings.defaultVolume}%\``,
              inline: true,
            },
            {
              name: 'DJ Role',
              value: settings.djRoleId ? `<@&${settings.djRoleId}>` : '`None`',
              inline: true,
            },
            {
              name: 'Music Channel',
              value: settings.textChannelId
                ? `<#${settings.textChannelId}>`
                : '`Any channel`',
              inline: true,
            },
            {
              name: 'Vote Skip',
              value: settings.voteSkipEnabled ? '`Enabled`' : '`Disabled`',
              inline: true,
            },
            {
              name: 'Vote Skip Threshold',
              value: `\`${formatPercent(settings.voteSkipThreshold)}\``,
              inline: true,
            },
            {
              name: '24/7 Mode',
              value: settings.twentyFourSevenEnabled
                ? '`Enabled`'
                : '`Disabled`',
              inline: true,
            },
          )
          .setTimestamp();

        await context.interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }
    }
  },
};

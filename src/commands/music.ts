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

const formatListenTime = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
};

const formatRestoreAge = (milliseconds: number): string => {
  if (milliseconds === 0) {
    return 'Disabled';
  }

  if (milliseconds < 60_000) {
    return `${Math.max(1, Math.round(milliseconds / 1000))}s`;
  }

  const hours = milliseconds / 3_600_000;

  if (hours >= 24 && hours % 24 === 0) {
    return `${hours / 24}d`;
  }

  if (hours >= 1 && Number.isInteger(hours)) {
    return `${hours}h`;
  }

  return `${Math.round(milliseconds / 60_000)}m`;
};

export const musicCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('View and manage server-wide music settings.')
    .setDMPermission(false)
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
            .setName('clear-saved-queue')
            .setDescription(
              'Clear the saved queue recovery snapshot for this server.',
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
    )
    .addSubcommandGroup((group) =>
      group
        .setName('stats')
        .setDescription('View listening stats.')
        .addSubcommand((subcommand) =>
          subcommand.setName('me').setDescription('Show your listening stats.'),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('server')
            .setDescription('Show server listening stats.'),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('top')
        .setDescription('Show music leaderboards.')
        .addSubcommand((subcommand) =>
          subcommand
            .setName('tracks')
            .setDescription('Show the most-played tracks.'),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('artists')
            .setDescription('Show the most-played artists.'),
        ),
    ),
  execute: async (context) => {
    const group = context.interaction.options.getSubcommandGroup(true);
    const subcommand = context.interaction.options.getSubcommand(true);
    const guildId = context.interaction.guildId;

    if (group === 'stats') {
      switch (subcommand) {
        case 'me': {
          const stats = context.musicStats.getUserStats(
            guildId,
            context.interaction.user.id,
          );
          const embed = new EmbedBuilder()
            .setColor(0x4f9eed)
            .setTitle('Your Listening Stats')
            .addFields(
              {
                name: 'Tracks Played',
                value: `\`${stats.trackCount}\``,
                inline: true,
              },
              {
                name: 'Listening Time',
                value: `\`${formatListenTime(stats.totalSeconds)}\``,
                inline: true,
              },
              {
                name: 'Favorite Artist',
                value: stats.favoriteArtist
                  ? `**${stats.favoriteArtist.name}** (${stats.favoriteArtist.plays})`
                  : '`None yet`',
                inline: true,
              },
              {
                name: 'Streak',
                value: `Current: \`${stats.currentStreakDays}d\`\nLongest: \`${stats.longestStreakDays}d\``,
                inline: true,
              },
              {
                name: 'Badges',
                value:
                  stats.badges.length > 0
                    ? stats.badges.map((badge) => `\`${badge}\``).join(' ')
                    : '`None yet`',
                inline: false,
              },
            )
            .setTimestamp();

          await context.interaction.reply({ embeds: [embed], ephemeral: true });
          return;
        }
        case 'server':
        default: {
          const stats = context.musicStats.getServerStats(guildId);
          const embed = new EmbedBuilder()
            .setColor(0x4f9eed)
            .setTitle('Server Listening Stats')
            .addFields(
              {
                name: 'Tracks Played',
                value: `\`${stats.trackCount}\``,
                inline: true,
              },
              {
                name: 'Listening Time',
                value: `\`${formatListenTime(stats.totalSeconds)}\``,
                inline: true,
              },
              {
                name: 'Requesters',
                value: `\`${stats.requesterCount}\``,
                inline: true,
              },
              {
                name: 'Top Track',
                value: stats.topTrack
                  ? `[${stats.topTrack.title}](${stats.topTrack.url}) (${stats.topTrack.plays})`
                  : '`None yet`',
                inline: false,
              },
              {
                name: 'Top Artist',
                value: stats.topArtist
                  ? `**${stats.topArtist.name}** (${stats.topArtist.plays})`
                  : '`None yet`',
                inline: true,
              },
              {
                name: 'Top Requester',
                value: stats.topRequester
                  ? `<@${stats.topRequester.userId}> (${stats.topRequester.plays})`
                  : '`None yet`',
                inline: true,
              },
            )
            .setTimestamp();

          await context.interaction.reply({ embeds: [embed] });
          return;
        }
      }
    }

    if (group === 'top') {
      if (subcommand === 'tracks') {
        const tracks = context.musicStats.getTopTracks(guildId, 10);
        const embed = new EmbedBuilder()
          .setColor(0x4f9eed)
          .setTitle('Top Tracks')
          .setDescription(
            tracks.length > 0
              ? tracks
                  .map(
                    (track, index) =>
                      `**${index + 1}.** [${track.title}](${track.url}) • \`${track.plays}\` play(s)`,
                  )
                  .join('\n')
              : 'No tracks have been played yet.',
          )
          .setTimestamp();

        await context.interaction.reply({ embeds: [embed] });
        return;
      }

      const artists = context.musicStats.getTopArtists(guildId, 10);
      const embed = new EmbedBuilder()
        .setColor(0x4f9eed)
        .setTitle('Top Artists')
        .setDescription(
          artists.length > 0
            ? artists
                .map(
                  (artist, index) =>
                    `**${index + 1}.** ${artist.name} • \`${artist.plays}\` play(s)`,
                )
                .join('\n')
            : 'No artists have been played yet.',
        )
        .setTimestamp();

      await context.interaction.reply({ embeds: [embed] });
      return;
    }

    if (group !== 'settings') {
      await context.replyError('That music command group is not available.');
      return;
    }

    if (
      !context.interaction.memberPermissions.has(
        PermissionFlagsBits.ManageGuild,
      )
    ) {
      await context.replyError(
        'You need Manage Server permission to change music settings.',
      );
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
      case 'clear-saved-queue': {
        await context.queueState.clear(guildId);
        await context.replySuccess(
          'Cleared the saved queue recovery snapshot for this server. Active playback was not changed.',
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
            {
              name: 'Queue Restore Window',
              value: `\`${formatRestoreAge(
                context.config.music.queueRestoreMaxAgeMs,
              )}\``,
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

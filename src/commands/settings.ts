import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { CommandModule } from '../types/bot';
import { settingTargets, type SettingTarget } from '../utils/utilityStore';
import { isTimezone } from '../utils/scheduling';

export const settingsCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription(
      'Configure this server’s bot channels, roles, and scheduling.',
    )
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s.setName('view').setDescription('Show this server’s settings.'),
    )
    .addSubcommand((s) =>
      s
        .setName('channel')
        .setDescription(
          'Bind a command family to a channel; omit channel to clear.',
        )
        .addStringOption((o) =>
          o
            .setName('target')
            .setDescription('Command family')
            .setRequired(true)
            .addChoices(
              ...settingTargets.map((value) => ({ name: value, value })),
            ),
        )
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Allowed text channel')
            .addChannelTypes(ChannelType.GuildText),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('role')
        .setDescription(
          'Require a role for a command family; omit role to clear.',
        )
        .addStringOption((o) =>
          o
            .setName('target')
            .setDescription('Command family')
            .setRequired(true)
            .addChoices(
              ...settingTargets.map((value) => ({ name: value, value })),
            ),
        )
        .addRoleOption((o) =>
          o.setName('role').setDescription('Required role'),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('timezone')
        .setDescription('Set the default timezone for events and reminders.')
        .addStringOption((o) =>
          o
            .setName('zone')
            .setDescription(
              'IANA timezone, e.g. America/New_York or Europe/London',
            )
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('event-reminder')
        .setDescription('Default attendee reminder lead time for new events.')
        .addIntegerOption((o) =>
          o
            .setName('minutes')
            .setDescription('Minutes before start; 0 disables reminders')
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(10080),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('lfg-expiry')
        .setDescription('Set the lifetime of new LFG posts.')
        .addIntegerOption((o) =>
          o
            .setName('minutes')
            .setDescription('Minutes until expiry')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(1440),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('leaderboard')
        .setDescription(
          'Set the Valorant leaderboard channel or omit it to disable.',
        )
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Leaderboard destination')
            .addChannelTypes(ChannelType.GuildText),
        )
        .addIntegerOption((o) =>
          o
            .setName('refresh-minutes')
            .setDescription('Refresh interval in minutes')
            .setMinValue(1)
            .setMaxValue(1440),
        ),
    ),
  execute: async (context) => {
    const { interaction, utilityStore } = context;
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
      await context.replyError(
        'You need Manage Server permission to change settings.',
      );
      return;
    }
    const sub = interaction.options.getSubcommand(true);
    const settings = utilityStore.getGuildSettings(interaction.guildId);
    if (sub === 'view') {
      await interaction.reply({
        ephemeral: true,
        embeds: [
          new EmbedBuilder()
            .setColor(0x4f9eed)
            .setTitle('Server Settings')
            .addFields(
              { name: 'Timezone', value: settings.timezone },
              {
                name: 'Event reminders',
                value: `${settings.eventReminderMinutes} minutes before start (0 = disabled)`,
              },
              {
                name: 'LFG expiry',
                value: `${settings.lfgExpiryMinutes} minutes`,
              },
              {
                name: 'Valorant leaderboard',
                value: `${settings.leaderboardChannelId ? `<#${settings.leaderboardChannelId}>` : 'Disabled'} · every ${settings.leaderboardRefreshMinutes} minutes`,
              },
              {
                name: 'Command channels',
                value: settingTargets
                  .map(
                    (t) =>
                      `${t}: ${settings.commandChannels[t] ? `<#${settings.commandChannels[t]}>` : 'Any channel'}`,
                  )
                  .join('\n'),
              },
              {
                name: 'Command roles',
                value: settingTargets
                  .map(
                    (t) =>
                      `${t}: ${settings.commandRoles[t] ? `<@&${settings.commandRoles[t]}>` : 'Everyone'}`,
                  )
                  .join('\n'),
              },
              {
                name: 'Music',
                value:
                  'Use `/music settings view` for music channel, DJ role, volume, 24/7, vote skip, and panel recovery settings.',
              },
            ),
        ],
      });
      return;
    }
    await context.deferReply({ ephemeral: true });
    if (sub === 'channel' || sub === 'role') {
      const target = interaction.options.getString(
        'target',
        true,
      ) as SettingTarget;
      const key = sub === 'channel' ? 'commandChannels' : 'commandRoles';
      const map = { ...settings[key] };
      const value =
        sub === 'channel'
          ? interaction.options.getChannel('channel')?.id
          : interaction.options.getRole('role')?.id;
      if (value) map[target] = value;
      else delete map[target];
      await utilityStore.updateGuildSettings(interaction.guildId, {
        [key]: map,
      });
    } else if (sub === 'timezone') {
      const timezone = interaction.options.getString('zone', true);
      if (!isTimezone(timezone)) {
        await context.replyError(
          'Use a valid IANA timezone, such as America/New_York, Europe/London, or UTC.',
        );
        return;
      }
      await utilityStore.updateGuildSettings(interaction.guildId, { timezone });
    } else if (sub === 'event-reminder') {
      await utilityStore.updateGuildSettings(interaction.guildId, {
        eventReminderMinutes: interaction.options.getInteger('minutes', true),
      });
    } else if (sub === 'lfg-expiry') {
      await utilityStore.updateGuildSettings(interaction.guildId, {
        lfgExpiryMinutes: interaction.options.getInteger('minutes', true),
      });
    } else if (sub === 'leaderboard') {
      const channel = interaction.options.getChannel('channel');
      if (channel) {
        const fetched = await interaction.guild.channels.fetch(channel.id);
        const me = await interaction.guild.members.fetchMe();
        if (
          !fetched?.isTextBased() ||
          !fetched
            .permissionsFor(me)
            ?.has([
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.EmbedLinks,
              PermissionFlagsBits.ReadMessageHistory,
            ])
        ) {
          await context.replyError(
            'I need View Channel, Send Messages, Embed Links, and Read Message History in that channel.',
          );
          return;
        }
      }
      await utilityStore.updateGuildSettings(interaction.guildId, {
        leaderboardChannelId: channel?.id ?? null,
        leaderboardRefreshMinutes:
          interaction.options.getInteger('refresh-minutes') ??
          settings.leaderboardRefreshMinutes,
      });
    }
    await context.replySuccess(
      'Server settings saved. Changes apply without restarting; leaderboard changes take effect within one minute.',
    );
  },
};

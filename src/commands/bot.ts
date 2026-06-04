import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';

import type { CommandModule } from '../types/bot';

const formatDuration = (totalSeconds: number): string => {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  const parts = [
    days > 0 ? `${days}d` : null,
    hours > 0 ? `${hours}h` : null,
    minutes > 0 ? `${minutes}m` : null,
    `${seconds}s`,
  ].filter((part): part is string => Boolean(part));

  return parts.join(' ');
};

const formatMegabytes = (bytes: number): string =>
  `${Math.round(bytes / 1024 / 1024)} MB`;

export const botCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('bot')
    .setDescription('Check bot health and runtime status.')
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('status')
        .setDescription('Show bot health and uptime.'),
    ),
  execute: async (context) => {
    const subcommand = context.interaction.options.getSubcommand(true);

    if (subcommand !== 'status') {
      await context.replyError('That bot command is not available.');
      return;
    }

    const memory = process.memoryUsage();
    const activeQueues = context.player.nodes.cache.size;
    const persistedQueues = context.queueState.getAll().length;
    const ping = context.interaction.client.ws.ping;
    const pingLabel = ping >= 0 ? `${Math.round(ping)} ms` : 'Connecting';

    const embed = new EmbedBuilder()
      .setColor(0x4f9eed)
      .setTitle('SollarisBot Status')
      .addFields(
        {
          name: 'Uptime',
          value: `\`${formatDuration(process.uptime())}\``,
          inline: true,
        },
        {
          name: 'Discord Ping',
          value: `\`${pingLabel}\``,
          inline: true,
        },
        {
          name: 'Servers',
          value: `\`${context.interaction.client.guilds.cache.size}\``,
          inline: true,
        },
        {
          name: 'Active Music Queues',
          value: `\`${activeQueues}\``,
          inline: true,
        },
        {
          name: 'Saved Queue Snapshots',
          value: `\`${persistedQueues}\``,
          inline: true,
        },
        {
          name: 'Memory',
          value: `RSS \`${formatMegabytes(memory.rss)}\`\nHeap \`${formatMegabytes(
            memory.heapUsed,
          )}\``,
          inline: true,
        },
        {
          name: 'Runtime',
          value: `Node \`${process.version}\``,
          inline: true,
        },
      )
      .setTimestamp();

    await context.interaction.reply({ embeds: [embed], ephemeral: true });
  },
};

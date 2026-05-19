import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';

import type { CommandModule } from '../types/bot';
import {
  requireControllableSession,
  syncQueueTextChannel,
} from '../music/guards';
import { requireDjOrOpenControl } from '../music/permissions';
import { createQueueSnapshot } from '../music/queueState';
import { describeRepeatMode, formatTrackLine } from '../music/service';

const QUEUE_PAGE_SIZE = 10;
const HISTORY_LIMIT = 10;

const requireQueueEditor = async (
  context: Parameters<CommandModule['execute']>[0],
) => requireDjOrOpenControl(context, 'manage the queue');

export const queueCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('View and manage the current queue.')
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand.setName('view').setDescription('Show the current queue.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('clear')
        .setDescription('Clear all upcoming tracks without stopping the current song.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('move')
        .setDescription('Move an upcoming track to a new queue position.')
        .addIntegerOption((option) =>
          option
            .setName('from')
            .setDescription('Current queue position, starting at 1')
            .setRequired(true)
            .setMinValue(1),
        )
        .addIntegerOption((option) =>
          option
            .setName('to')
            .setDescription('New queue position, starting at 1')
            .setRequired(true)
            .setMinValue(1),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('remove')
        .setDescription('Remove a track from the upcoming queue.')
        .addIntegerOption((option) =>
          option
            .setName('position')
            .setDescription('The queue position to remove, starting at 1')
            .setRequired(true)
            .setMinValue(1),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('shuffle')
        .setDescription('Shuffle the upcoming queue.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('jump')
        .setDescription('Skip directly to an upcoming queue position.')
        .addIntegerOption((option) =>
          option
            .setName('position')
            .setDescription('Upcoming queue position, starting at 1')
            .setRequired(true)
            .setMinValue(1),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('history')
        .setDescription('Show recently played tracks.'),
    ),
  execute: async (context) => {
    const subcommand = context.interaction.options.getSubcommand(true);
    const session = await requireControllableSession(context);

    if (!session) {
      return;
    }

    const { queue } = session;

    switch (subcommand) {
      case 'view': {
        if (!queue.currentTrack && queue.isEmpty()) {
          await context.replyError('The queue is empty right now.');
          return;
        }

        syncQueueTextChannel(context.interaction, queue);

        const upcomingTracks = queue.tracks.toArray();
        const embed = new EmbedBuilder()
          .setColor(0x4f9eed)
          .setTitle(`Queue for ${context.interaction.guild.name}`)
          .setTimestamp()
          .addFields({
            name: 'Now Playing',
            value: queue.currentTrack
              ? formatTrackLine(queue.currentTrack)
              : 'Nothing is currently playing.',
          })
          .addFields({
            name: 'Queue Settings',
            value: [
              `Repeat: \`${describeRepeatMode(queue.repeatMode)}\``,
              `Volume: \`${queue.node.volume}%\``,
              `Upcoming: \`${queue.size}\``,
            ].join('\n'),
          });

        if (upcomingTracks.length > 0) {
          embed.addFields({
            name: 'Up Next',
            value: upcomingTracks
              .slice(0, QUEUE_PAGE_SIZE)
              .map((track, index) => formatTrackLine(track, index + 1))
              .join('\n'),
          });
        }

        if (upcomingTracks.length > QUEUE_PAGE_SIZE) {
          embed.setFooter({
            text: `Showing ${QUEUE_PAGE_SIZE} of ${upcomingTracks.length} queued tracks.`,
          });
        }

        await context.interaction.reply({ embeds: [embed] });
        return;
      }
      case 'clear': {
        if (!(await requireQueueEditor(context))) {
          return;
        }

        const clearedCount = queue.size;

        if (clearedCount === 0) {
          await context.replyError('There are no upcoming tracks to clear.');
          return;
        }

        queue.clear();
        const snapshot = createQueueSnapshot(queue);
        if (snapshot) {
          await context.queueState.save(snapshot);
        }
        syncQueueTextChannel(context.interaction, queue);
        await context.replySuccess(`Cleared **${clearedCount}** upcoming track(s).`);
        return;
      }
      case 'move': {
        if (!(await requireQueueEditor(context))) {
          return;
        }

        const from = context.interaction.options.getInteger('from', true);
        const to = context.interaction.options.getInteger('to', true);
        const fromIndex = from - 1;
        const toIndex = to - 1;
        const track = queue.tracks.at(fromIndex);

        if (!track) {
          await context.replyError(`There is no queued track at position **${from}**.`);
          return;
        }

        if (toIndex < 0 || toIndex >= queue.size) {
          await context.replyError(
            `Move destination must be between **1** and **${queue.size}**.`,
          );
          return;
        }

        queue.node.move(fromIndex, toIndex);
        syncQueueTextChannel(context.interaction, queue);
        await context.replySuccess(
          `Moved ${formatTrackLine(track)} to position **${to}**.`,
        );
        return;
      }
      case 'remove': {
        if (!(await requireQueueEditor(context))) {
          return;
        }

        const position = context.interaction.options.getInteger('position', true);
        const targetIndex = position - 1;
        const targetTrack = queue.tracks.at(targetIndex);

        if (!targetTrack) {
          await context.replyError(
            `There is no queued track at position **${position}**.`,
          );
          return;
        }

        queue.node.remove(targetIndex);
        syncQueueTextChannel(context.interaction, queue);
        await context.replySuccess(`Removed **${targetTrack.title}** from the queue.`);
        return;
      }
      case 'shuffle': {
        if (!(await requireQueueEditor(context))) {
          return;
        }

        if (queue.size < 2) {
          await context.replyError('You need at least two queued tracks to shuffle.');
          return;
        }

        queue.enableShuffle(false);
        syncQueueTextChannel(context.interaction, queue);
        await context.replySuccess('Shuffled the upcoming tracks.');
        return;
      }
      case 'jump': {
        if (!(await requireQueueEditor(context))) {
          return;
        }

        const position = context.interaction.options.getInteger('position', true);
        const targetIndex = position - 1;
        const targetTrack = queue.tracks.at(targetIndex);

        if (!targetTrack) {
          await context.replyError(
            `There is no queued track at position **${position}**.`,
          );
          return;
        }

        const skipped = queue.node.skipTo(targetIndex);

        if (!skipped) {
          await context.replyError('I could not skip to that track.');
          return;
        }

        syncQueueTextChannel(context.interaction, queue);
        await context.replySuccess(`Skipped to **${targetTrack.title}**.`);
        return;
      }
      case 'history':
      default: {
        const tracks = queue.history.tracks.toArray().slice(-HISTORY_LIMIT).reverse();

        if (tracks.length === 0) {
          await context.replyError('No tracks have been played in this session yet.');
          return;
        }

        syncQueueTextChannel(context.interaction, queue);

        const embed = new EmbedBuilder()
          .setColor(0x4f9eed)
          .setTitle('Recently Played')
          .setDescription(
            tracks.map((track, index) => formatTrackLine(track, index + 1)).join('\n'),
          )
          .setTimestamp();

        await context.interaction.reply({ embeds: [embed] });
        return;
      }
    }
  },
};

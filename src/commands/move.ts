import { SlashCommandBuilder } from 'discord.js';

import type { CommandModule } from '../types/bot';
import { formatTrackLine } from '../music/service';
import { requireControllableSession, syncQueueTextChannel } from '../music/guards';

export const moveCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('move')
    .setDescription('Move an upcoming track to a new queue position.')
    .setDMPermission(false)
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
  execute: async (context) => {
    const session = await requireControllableSession(context);

    if (!session) {
      return;
    }

    const { queue } = session;
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
    await context.replySuccess(`Moved ${formatTrackLine(track)} to position **${to}**.`);
  },
};

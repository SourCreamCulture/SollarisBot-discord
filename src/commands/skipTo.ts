import { SlashCommandBuilder } from 'discord.js';

import type { CommandModule } from '../types/bot';
import { requireControllableSession, syncQueueTextChannel } from '../music/guards';

export const skipToCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('skipto')
    .setDescription('Skip directly to an upcoming queue position.')
    .setDMPermission(false)
    .addIntegerOption((option) =>
      option
        .setName('position')
        .setDescription('Upcoming queue position, starting at 1')
        .setRequired(true)
        .setMinValue(1),
    ),
  execute: async (context) => {
    const session = await requireControllableSession(context);

    if (!session) {
      return;
    }

    const { queue } = session;
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
  },
};

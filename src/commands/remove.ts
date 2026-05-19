import { SlashCommandBuilder } from 'discord.js';

import type { CommandModule } from '../types/bot';
import { requireControllableSession, syncQueueTextChannel } from '../music/guards';

export const removeCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove a track from the upcoming queue by its position.')
    .setDMPermission(false)
    .addIntegerOption((option) =>
      option
        .setName('position')
        .setDescription('The queue position to remove, starting at 1')
        .setRequired(true)
        .setMinValue(1),
    ),
  execute: async (context) => {
    const session = await requireControllableSession(context);

    if (!session) {
      return;
    }

    const position = context.interaction.options.getInteger('position', true);
    const queue = session.queue;
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
  },
};

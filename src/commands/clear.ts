import { SlashCommandBuilder } from 'discord.js';

import type { CommandModule } from '../types/bot';
import { createQueueSnapshot } from '../music/queueState';
import { requireControllableSession, syncQueueTextChannel } from '../music/guards';

export const clearCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Clear all upcoming tracks without stopping the current song.')
    .setDMPermission(false),
  execute: async (context) => {
    const session = await requireControllableSession(context);

    if (!session) {
      return;
    }

    const { queue } = session;
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
  },
};

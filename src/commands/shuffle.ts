import { SlashCommandBuilder } from 'discord.js';

import type { CommandModule } from '../types/bot';
import { requireControllableSession, syncQueueTextChannel } from '../music/guards';

export const shuffleCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('Shuffle the upcoming queue.')
    .setDMPermission(false),
  execute: async (context) => {
    const session = await requireControllableSession(context);

    if (!session) {
      return;
    }

    const { queue } = session;

    if (queue.size < 2) {
      await context.replyError('You need at least two queued tracks to shuffle.');
      return;
    }

    queue.enableShuffle(false);
    syncQueueTextChannel(context.interaction, queue);
    await context.replySuccess('Shuffled the upcoming tracks.');
  },
};

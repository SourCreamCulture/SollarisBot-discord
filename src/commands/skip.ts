import { SlashCommandBuilder } from 'discord.js';

import type { CommandModule } from '../types/bot';
import { requireControllableSession, syncQueueTextChannel } from '../music/guards';

export const skipCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip the current track.')
    .setDMPermission(false),
  execute: async (context) => {
    const session = await requireControllableSession(context);

    if (!session) {
      return;
    }

    const { queue } = session;
    const currentTrack = queue.currentTrack;

    if (!currentTrack) {
      await context.replyError('There is no track to skip.');
      return;
    }

    const skipped = queue.node.skip();

    if (!skipped) {
      await context.replyError('I could not skip the current track.');
      return;
    }

    syncQueueTextChannel(context.interaction, queue);
    await context.replySuccess(`Skipped **${currentTrack.title}**.`);
  },
};

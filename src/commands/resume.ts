import { SlashCommandBuilder } from 'discord.js';

import type { CommandModule } from '../types/bot';
import { requireControllableSession, syncQueueTextChannel } from '../music/guards';

export const resumeCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Resume the current track.')
    .setDMPermission(false),
  execute: async (context) => {
    const session = await requireControllableSession(context);

    if (!session) {
      return;
    }

    const { queue } = session;

    if (!queue.currentTrack) {
      await context.replyError('There is nothing to resume right now.');
      return;
    }

    if (!queue.node.isPaused()) {
      await context.replyInfo('Playback is already running.');
      return;
    }

    queue.node.resume();
    syncQueueTextChannel(context.interaction, queue);
    await context.replySuccess(`Resumed **${queue.currentTrack.title}**.`);
  },
};

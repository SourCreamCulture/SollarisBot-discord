import { SlashCommandBuilder } from 'discord.js';

import type { CommandModule } from '../types/bot';
import { requireControllableSession, syncQueueTextChannel } from '../music/guards';

export const pauseCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pause the current track.')
    .setDMPermission(false),
  execute: async (context) => {
    const session = await requireControllableSession(context);

    if (!session) {
      return;
    }

    const { queue } = session;

    if (!queue.currentTrack) {
      await context.replyError('There is nothing playing right now.');
      return;
    }

    if (queue.node.isPaused()) {
      await context.replyInfo('Playback is already paused.');
      return;
    }

    queue.node.pause();
    syncQueueTextChannel(context.interaction, queue);
    await context.replySuccess(`Paused **${queue.currentTrack.title}**.`);
  },
};

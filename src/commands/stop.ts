import { SlashCommandBuilder } from 'discord.js';
import { QueueRepeatMode } from 'discord-player';

import type { CommandModule } from '../types/bot';
import { requireControllableSession, syncQueueTextChannel } from '../music/guards';

export const stopCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop playback and clear the queue.')
    .setDMPermission(false),
  execute: async (context) => {
    const session = await requireControllableSession(context);

    if (!session) {
      return;
    }

    const { queue } = session;

    if (!queue.currentTrack && queue.isEmpty()) {
      await context.replyError('There is nothing playing to stop.');
      return;
    }

    queue.clear();
    queue.setRepeatMode(QueueRepeatMode.OFF);
    queue.node.stop();
    await context.queueState.clear(context.interaction.guildId);
    syncQueueTextChannel(context.interaction, queue);

    await context.replySuccess(
      'Stopped playback, cleared the queue, and started the disconnect timer.',
    );
  },
};

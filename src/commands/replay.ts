import { SlashCommandBuilder } from 'discord.js';

import type { CommandModule } from '../types/bot';
import { requireControllableSession, syncQueueTextChannel } from '../music/guards';

export const replayCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('replay')
    .setDescription('Restart the current track from the beginning.')
    .setDMPermission(false),
  execute: async (context) => {
    const session = await requireControllableSession(context);

    if (!session) {
      return;
    }

    const { queue } = session;
    const track = queue.currentTrack;

    if (!track) {
      await context.replyError('There is no current track to replay.');
      return;
    }

    if (!track.seekable) {
      await context.replyError('This track cannot be replayed because it is not seekable.');
      return;
    }

    const replayed = await queue.node.seek(0);

    if (!replayed) {
      await context.replyError('I could not restart the current track.');
      return;
    }

    syncQueueTextChannel(context.interaction, queue);
    await context.replySuccess(`Restarted **${track.title}**.`);
  },
};

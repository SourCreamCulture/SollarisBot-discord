import { SlashCommandBuilder } from 'discord.js';
import { QueueRepeatMode } from 'discord-player';

import type { CommandModule } from '../types/bot';
import { createQueueSnapshot } from '../music/queueState';
import { requireControllableSession, syncQueueTextChannel } from '../music/guards';

export const autoplayCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('autoplay')
    .setDescription('Toggle autoplay for related tracks when the queue runs out.')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('state')
        .setDescription('Turn autoplay on or off')
        .setRequired(true)
        .addChoices(
          { name: 'On', value: 'on' },
          { name: 'Off', value: 'off' },
        ),
    ),
  execute: async (context) => {
    const session = await requireControllableSession(context);

    if (!session) {
      return;
    }

    const state = context.interaction.options.getString('state', true);
    session.queue.setRepeatMode(
      state === 'on' ? QueueRepeatMode.AUTOPLAY : QueueRepeatMode.OFF,
    );
    const snapshot = createQueueSnapshot(session.queue);
    if (snapshot) {
      await context.queueState.save(snapshot);
    }
    syncQueueTextChannel(context.interaction, session.queue);
    await context.replySuccess(
      state === 'on'
        ? 'Autoplay is now enabled.'
        : 'Autoplay is now disabled.',
    );
  },
};

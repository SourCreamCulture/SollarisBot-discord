import { SlashCommandBuilder } from 'discord.js';

import type { CommandModule } from '../types/bot';
import { requireControllableSession, syncQueueTextChannel } from '../music/guards';

export const volumeCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Set the playback volume.')
    .setDMPermission(false)
    .addIntegerOption((option) =>
      option
        .setName('percent')
        .setDescription('A volume value from 1 to 100')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100),
    ),
  execute: async (context) => {
    const session = await requireControllableSession(context);

    if (!session) {
      return;
    }

    const volume = context.interaction.options.getInteger('percent', true);
    const changed = session.queue.node.setVolume(volume);

    if (!changed) {
      await context.replyError('I could not update the volume right now.');
      return;
    }

    syncQueueTextChannel(context.interaction, session.queue);
    await context.replySuccess(`Volume set to **${volume}%**.`);
  },
};

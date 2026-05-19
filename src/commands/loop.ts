import { SlashCommandBuilder } from 'discord.js';
import { QueueRepeatMode } from 'discord-player';

import type { CommandModule } from '../types/bot';
import { createQueueSnapshot } from '../music/queueState';
import { requireControllableSession, syncQueueTextChannel } from '../music/guards';

const repeatModeMap = {
  off: QueueRepeatMode.OFF,
  track: QueueRepeatMode.TRACK,
  queue: QueueRepeatMode.QUEUE,
} as const;

export const loopCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Set the repeat mode for the queue.')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('mode')
        .setDescription('The repeat mode to use')
        .setRequired(true)
        .addChoices(
          { name: 'Off', value: 'off' },
          { name: 'Track', value: 'track' },
          { name: 'Queue', value: 'queue' },
        ),
    ),
  execute: async (context) => {
    const session = await requireControllableSession(context);

    if (!session) {
      return;
    }

    const mode = context.interaction.options.getString('mode', true) as keyof typeof repeatModeMap;
    session.queue.setRepeatMode(repeatModeMap[mode]);
    const snapshot = createQueueSnapshot(session.queue);
    if (snapshot) {
      await context.queueState.save(snapshot);
    }
    syncQueueTextChannel(context.interaction, session.queue);
    await context.replySuccess(`Repeat mode is now set to **${mode}**.`);
  },
};

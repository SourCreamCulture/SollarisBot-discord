import { SlashCommandBuilder } from 'discord.js';

import type { CommandModule } from '../types/bot';
import { requireControllableSession } from '../music/guards';

export const leaveCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Disconnect the bot from the voice channel.')
    .setDMPermission(false),
  execute: async (context) => {
    const session = await requireControllableSession(context);

    if (!session) {
      return;
    }

    session.queue.delete();
    await context.queueState.clear(context.interaction.guildId);
    await context.replySuccess('Disconnected from voice chat and cleared the session.');
  },
};

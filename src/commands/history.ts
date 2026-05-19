import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';

import type { CommandModule } from '../types/bot';
import { requireControllableSession, syncQueueTextChannel } from '../music/guards';
import { formatTrackLine } from '../music/service';

const HISTORY_LIMIT = 10;

export const historyCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('Show recently played tracks.')
    .setDMPermission(false),
  execute: async (context) => {
    const session = await requireControllableSession(context);

    if (!session) {
      return;
    }

    const { queue } = session;
    const tracks = queue.history.tracks.toArray().slice(-HISTORY_LIMIT).reverse();

    if (tracks.length === 0) {
      await context.replyError('No tracks have been played in this session yet.');
      return;
    }

    syncQueueTextChannel(context.interaction, queue);

    const embed = new EmbedBuilder()
      .setColor(0x4f9eed)
      .setTitle('Recently Played')
      .setDescription(
        tracks.map((track, index) => formatTrackLine(track, index + 1)).join('\n'),
      )
      .setTimestamp();

    await context.interaction.reply({ embeds: [embed] });
  },
};

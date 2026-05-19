import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';

import type { CommandModule } from '../types/bot';
import { requireControllableSession, syncQueueTextChannel } from '../music/guards';
import { describeRepeatMode } from '../music/service';

export const nowPlayingCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Show details about the current track.')
    .setDMPermission(false),
  execute: async (context) => {
    const session = await requireControllableSession(context);

    if (!session) {
      return;
    }

    const { queue } = session;
    const track = queue.currentTrack;

    if (!track) {
      await context.replyError('There is no current track right now.');
      return;
    }

    syncQueueTextChannel(context.interaction, queue);

    const timestamp = queue.node.getTimestamp();
    const progressBar = queue.node.createProgressBar();
    const description = [
      `[${track.title}](${track.url})`,
      '',
      progressBar ?? '`No progress data available yet.`',
      timestamp
        ? `Elapsed: \`${timestamp.current.label}\` / \`${timestamp.total.label}\``
        : `Duration: \`${track.duration}\``,
      `Repeat: \`${describeRepeatMode(queue.repeatMode)}\``,
      `Volume: \`${queue.node.volume}%\``,
      `Requested by: ${track.requestedBy?.toString() ?? 'Unknown user'}`,
    ].join('\n');

    const embed = new EmbedBuilder()
      .setColor(0x4f9eed)
      .setTitle('Now Playing')
      .setDescription(description)
      .setThumbnail(track.thumbnail)
      .setTimestamp();

    await context.interaction.reply({ embeds: [embed] });
  },
};

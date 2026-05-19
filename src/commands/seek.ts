import { SlashCommandBuilder } from 'discord.js';

import type { CommandModule } from '../types/bot';
import { requireControllableSession, syncQueueTextChannel } from '../music/guards';
import { formatDuration, parseSeekTime } from '../music/time';

export const seekCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('seek')
    .setDescription('Jump to a timestamp in the current track.')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('time')
        .setDescription('Timestamp like 1:23, 01:02:03, 90s, or 2m30s')
        .setRequired(true),
    ),
  execute: async (context) => {
    const session = await requireControllableSession(context);

    if (!session) {
      return;
    }

    const { queue } = session;
    const track = queue.currentTrack;

    if (!track) {
      await context.replyError('There is no current track to seek through.');
      return;
    }

    if (!track.seekable) {
      await context.replyError('This track cannot be seeked.');
      return;
    }

    const input = context.interaction.options.getString('time', true);
    const milliseconds = parseSeekTime(input);

    if (milliseconds === null) {
      await context.replyError(
        'Use a timestamp like `1:23`, `01:02:03`, `90s`, or `2m30s`.',
      );
      return;
    }

    if (track.durationMS > 0 && milliseconds >= track.durationMS) {
      await context.replyError(
        `That timestamp is beyond the track length of \`${track.duration}\`.`,
      );
      return;
    }

    const seeked = await queue.node.seek(milliseconds);

    if (!seeked) {
      await context.replyError('I could not seek the current track.');
      return;
    }

    syncQueueTextChannel(context.interaction, queue);
    await context.replySuccess(
      `Jumped to \`${formatDuration(milliseconds)}\` in **${track.title}**.`,
    );
  },
};

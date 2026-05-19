import { SlashCommandBuilder } from 'discord.js';

import type { CommandModule } from '../types/bot';
import { requireControllableSession, syncQueueTextChannel } from '../music/guards';

export const voteSkipCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('voteskip')
    .setDescription('Vote with other listeners to skip the current track.')
    .setDMPermission(false),
  execute: async (context) => {
    const session = await requireControllableSession(context);

    if (!session) {
      return;
    }

    const { queue, voiceChannel } = session;
    const track = queue.currentTrack;

    if (!track) {
      await context.replyError('There is no current track to vote skip.');
      return;
    }

    const settings = context.musicSettings.getSettings(context.interaction.guildId);

    if (!settings.voteSkipEnabled) {
      await context.replyError('Vote skip is disabled in this server.');
      return;
    }

    const eligibleVoters = voiceChannel.members.filter(
      (member) => !member.user.bot,
    ).size;
    const result = context.voteSkips.registerVote({
      guildId: context.interaction.guildId,
      track,
      voterId: context.interaction.user.id,
      eligibleVoters,
      threshold: settings.voteSkipThreshold,
    });

    if (result.alreadyVoted) {
      await context.replyInfo(
        `You already voted to skip **${track.title}**. Current votes: **${result.votes}/${result.requiredVotes}**.`,
      );
      return;
    }

    if (!result.passed) {
      await context.replyInfo(
        `Vote recorded for **${track.title}**. Current votes: **${result.votes}/${result.requiredVotes}**.`,
      );
      return;
    }

    const skipped = queue.node.skip();

    if (!skipped) {
      await context.replyError('The vote passed, but I could not skip the track.');
      return;
    }

    context.voteSkips.clearGuild(context.interaction.guildId);
    syncQueueTextChannel(context.interaction, queue);
    await context.replySuccess(
      `Vote passed: **${result.votes}/${result.requiredVotes}**. Skipped **${track.title}**.`,
    );
  },
};

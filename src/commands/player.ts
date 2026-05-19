import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { QueueRepeatMode } from 'discord-player';

import type { CommandModule } from '../types/bot';
import {
  requireControllableSession,
  syncQueueTextChannel,
} from '../music/guards';
import { requireDjOrOpenControl } from '../music/permissions';
import { createQueueSnapshot } from '../music/queueState';
import { describeRepeatMode } from '../music/service';
import { formatDuration, parseSeekTime } from '../music/time';

const repeatModeMap = {
  off: QueueRepeatMode.OFF,
  track: QueueRepeatMode.TRACK,
  queue: QueueRepeatMode.QUEUE,
} as const;

const requirePlayerControl = async (
  context: Parameters<CommandModule['execute']>[0],
  action: string,
) => requireDjOrOpenControl(context, action);

export const playerCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('player')
    .setDescription('Control playback and inspect what is playing right now.')
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand.setName('now').setDescription('Show details about the current track.'),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('pause').setDescription('Pause the current track.'),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('resume').setDescription('Resume the current track.'),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('skip').setDescription('Skip the current track.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('stop')
        .setDescription('Stop playback and clear the queue.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('leave')
        .setDescription('Disconnect the bot from the voice channel.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('loop')
        .setDescription('Set the repeat mode for the queue.')
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
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('seek')
        .setDescription('Jump to a timestamp in the current track.')
        .addStringOption((option) =>
          option
            .setName('time')
            .setDescription('Timestamp like 1:23, 01:02:03, 90s, or 2m30s')
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('replay')
        .setDescription('Restart the current track from the beginning.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('volume')
        .setDescription('Set the playback volume.')
        .addIntegerOption((option) =>
          option
            .setName('percent')
            .setDescription('A volume value from 1 to 100')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('autoplay')
        .setDescription('Toggle autoplay for related tracks when the queue runs out.')
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
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('voteskip')
        .setDescription('Vote with other listeners to skip the current track.'),
    ),
  execute: async (context) => {
    const subcommand = context.interaction.options.getSubcommand(true);
    const session = await requireControllableSession(context);

    if (!session) {
      return;
    }

    const { queue, voiceChannel } = session;

    switch (subcommand) {
      case 'now': {
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
        return;
      }
      case 'pause': {
        if (!(await requirePlayerControl(context, 'pause playback'))) {
          return;
        }

        if (!queue.currentTrack) {
          await context.replyError('There is nothing playing right now.');
          return;
        }

        if (queue.node.isPaused()) {
          await context.replyInfo('Playback is already paused.');
          return;
        }

        queue.node.pause();
        syncQueueTextChannel(context.interaction, queue);
        await context.replySuccess(`Paused **${queue.currentTrack.title}**.`);
        return;
      }
      case 'resume': {
        if (!(await requirePlayerControl(context, 'resume playback'))) {
          return;
        }

        if (!queue.currentTrack) {
          await context.replyError('There is nothing to resume right now.');
          return;
        }

        if (!queue.node.isPaused()) {
          await context.replyInfo('Playback is already running.');
          return;
        }

        queue.node.resume();
        syncQueueTextChannel(context.interaction, queue);
        await context.replySuccess(`Resumed **${queue.currentTrack.title}**.`);
        return;
      }
      case 'skip': {
        if (!(await requirePlayerControl(context, 'skip tracks'))) {
          return;
        }

        const currentTrack = queue.currentTrack;

        if (!currentTrack) {
          await context.replyError('There is no track to skip.');
          return;
        }

        const skipped = queue.node.skip();

        if (!skipped) {
          await context.replyError('I could not skip the current track.');
          return;
        }

        syncQueueTextChannel(context.interaction, queue);
        await context.replySuccess(`Skipped **${currentTrack.title}**.`);
        return;
      }
      case 'stop': {
        if (!(await requirePlayerControl(context, 'stop playback'))) {
          return;
        }

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
        return;
      }
      case 'leave': {
        if (!(await requirePlayerControl(context, 'disconnect the bot'))) {
          return;
        }

        queue.delete();
        await context.queueState.clear(context.interaction.guildId);
        await context.replySuccess('Disconnected from voice chat and cleared the session.');
        return;
      }
      case 'loop': {
        if (!(await requirePlayerControl(context, 'change repeat mode'))) {
          return;
        }

        const mode = context.interaction.options.getString(
          'mode',
          true,
        ) as keyof typeof repeatModeMap;
        queue.setRepeatMode(repeatModeMap[mode]);
        const snapshot = createQueueSnapshot(queue);
        if (snapshot) {
          await context.queueState.save(snapshot);
        }
        syncQueueTextChannel(context.interaction, queue);
        await context.replySuccess(`Repeat mode is now set to **${mode}**.`);
        return;
      }
      case 'seek': {
        if (!(await requirePlayerControl(context, 'seek through tracks'))) {
          return;
        }

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
        return;
      }
      case 'replay': {
        if (!(await requirePlayerControl(context, 'restart tracks'))) {
          return;
        }

        const track = queue.currentTrack;

        if (!track) {
          await context.replyError('There is no current track to replay.');
          return;
        }

        if (!track.seekable) {
          await context.replyError(
            'This track cannot be replayed because it is not seekable.',
          );
          return;
        }

        const replayed = await queue.node.seek(0);

        if (!replayed) {
          await context.replyError('I could not restart the current track.');
          return;
        }

        syncQueueTextChannel(context.interaction, queue);
        await context.replySuccess(`Restarted **${track.title}**.`);
        return;
      }
      case 'volume': {
        if (!(await requirePlayerControl(context, 'change the volume'))) {
          return;
        }

        const volume = context.interaction.options.getInteger('percent', true);
        const changed = queue.node.setVolume(volume);

        if (!changed) {
          await context.replyError('I could not update the volume right now.');
          return;
        }

        syncQueueTextChannel(context.interaction, queue);
        await context.replySuccess(`Volume set to **${volume}%**.`);
        return;
      }
      case 'autoplay': {
        if (!(await requirePlayerControl(context, 'change autoplay'))) {
          return;
        }

        const state = context.interaction.options.getString('state', true);
        queue.setRepeatMode(
          state === 'on' ? QueueRepeatMode.AUTOPLAY : QueueRepeatMode.OFF,
        );
        const snapshot = createQueueSnapshot(queue);
        if (snapshot) {
          await context.queueState.save(snapshot);
        }
        syncQueueTextChannel(context.interaction, queue);
        await context.replySuccess(
          state === 'on'
            ? 'Autoplay is now enabled.'
            : 'Autoplay is now disabled.',
        );
        return;
      }
      case 'voteskip':
      default: {
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
        return;
      }
    }
  },
};

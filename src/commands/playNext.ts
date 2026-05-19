import { SlashCommandBuilder } from 'discord.js';

import type { CommandModule } from '../types/bot';
import {
  ensureSameVoiceChannel,
  requireVoiceChannel,
  resolveMember,
  resolveTextChannel,
  syncQueueTextChannel,
} from '../music/guards';
import { getGuildSession, playTrack } from '../music/service';

export const playNextCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('playnext')
    .setDescription('Queue a song to play immediately after the current track.')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('A YouTube search term or URL')
        .setRequired(true),
    ),
  execute: async (context) => {
    await context.deferReply();

    const voiceChannel = await requireVoiceChannel(context);
    const textChannel = resolveTextChannel(context.interaction);

    if (!voiceChannel || !textChannel) {
      await context.editReply({
        title: 'Music Error',
        description: 'I can only manage music from a server text channel.',
      });
      return;
    }

    const query = context.interaction.options.getString('query', true);
    const member = await resolveMember(context.interaction);
    const queue = getGuildSession(context.player, context.interaction.guildId);
    const settings = context.musicSettings.getSettings(context.interaction.guildId);

    if (!queue || !queue.currentTrack) {
      const result = await playTrack(context.player, context.config, {
        query,
        member,
        voiceChannel,
        textChannel,
        defaultVolume: settings.defaultVolume,
        stayConnected: settings.twentyFourSevenEnabled,
      });

      await context.editReply({
        title: 'Now Playing',
        description: `[${result.track.title}](${result.track.url}) • \`${result.track.duration}\``,
      });
      return;
    }

    if (!(await ensureSameVoiceChannel(context, queue, voiceChannel))) {
      return;
    }

    const searchResult = await context.player.search(query, {
      requestedBy: member.user,
      searchEngine: context.config.music.youtubeSearchEngine,
    });

    if (searchResult.isEmpty()) {
      await context.editReply({
        title: 'Music Error',
        description: `I could not find anything for \`${query}\`.`,
      });
      return;
    }

    const tracks = searchResult.tracks;
    queue.prepend(tracks);
    syncQueueTextChannel(context.interaction, queue);

    await context.editReply({
      title: 'Queued Next',
      description:
        tracks.length === 1
          ? `[${tracks[0].title}](${tracks[0].url}) will play next.`
          : `Added **${tracks.length}** tracks to the front of the queue.`,
    });
  },
};

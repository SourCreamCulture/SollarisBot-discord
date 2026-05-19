import { SlashCommandBuilder } from 'discord.js';

import type { CommandModule } from '../types/bot';
import {
  ensureSameVoiceChannel,
  requireVoiceChannel,
  resolveMember,
  resolveTextChannel,
  syncQueueTextChannel,
} from '../music/guards';
import { queueResolvedTracks } from '../music/libraryPlayback';
import {
  isSpotifyPlaylistQuery,
  resolveSpotifyPlaylistToYoutubeTracks,
} from '../music/spotify';
import { getGuildSession, playTrack } from '../music/service';

const queueNow = async (
  context: Parameters<CommandModule['execute']>[0],
  query: string,
) => {
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

  const existingQueue = getGuildSession(context.player, context.interaction.guildId);

  if (existingQueue) {
    const canControl = await ensureSameVoiceChannel(
      context,
      existingQueue,
      voiceChannel,
    );

    if (!canControl) {
      return;
    }
  }

  const member = await resolveMember(context.interaction);
  const settings = context.musicSettings.getSettings(context.interaction.guildId);

  try {
    if (isSpotifyPlaylistQuery(query)) {
      const resolvedPlaylist = await resolveSpotifyPlaylistToYoutubeTracks(
        context.player,
        context.config,
        member.user,
        query,
      );

      if (resolvedPlaylist.resolvedTracks.length === 0) {
        await context.editReply({
          title: 'Playlist Not Found',
          description:
            'I could read that Spotify playlist, but I could not match any of its songs on YouTube.',
        });
        return;
      }

      const queued = await queueResolvedTracks(context, resolvedPlaylist.resolvedTracks);

      if (!queued) {
        return;
      }

      const unresolvedLine =
        resolvedPlaylist.unresolvedTracks.length > 0
          ? `\nSkipped **${resolvedPlaylist.unresolvedTracks.length}** track(s) that I couldn't match on YouTube.`
          : '';

      await context.editReply({
        title: 'Spotify Playlist Loaded',
        description: `${queued.startedPlayback ? 'Playing' : 'Queued'} **${resolvedPlaylist.title}** with **${queued.queuedCount}** YouTube match(es).${unresolvedLine}`,
      });
      return;
    }

    const result = await playTrack(context.player, context.config, {
      query,
      member,
      voiceChannel,
      textChannel,
      defaultVolume: settings.defaultVolume,
      stayConnected: settings.twentyFourSevenEnabled,
    });

    if (result.searchResult.playlist) {
      const playlist = result.searchResult.playlist;
      const action = result.startedPlayback ? 'Playing' : 'Queued';

      await context.editReply({
        title: 'Playlist Loaded',
        description: `${action} **${playlist.title}** with **${playlist.tracks.length}** tracks.`,
      });
      return;
    }

    const action = result.startedPlayback ? 'Now playing' : 'Queued';
    await context.editReply({
      title: 'Track Loaded',
      description: `${action} [${result.track.title}](${result.track.url}) • \`${result.track.duration}\``,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown playback error.';

    context.logger.error('Failed to play track.', error);
    await context.editReply({
      title: 'Music Error',
      description: `I couldn't play that query.\n\`${message}\``,
    });
  }
};

const queueNext = async (
  context: Parameters<CommandModule['execute']>[0],
  query: string,
) => {
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

  if (isSpotifyPlaylistQuery(query)) {
    const resolvedPlaylist = await resolveSpotifyPlaylistToYoutubeTracks(
      context.player,
      context.config,
      member.user,
      query,
    );

    if (resolvedPlaylist.resolvedTracks.length === 0) {
      await context.editReply({
        title: 'Playlist Not Found',
        description:
          'I could read that Spotify playlist, but I could not match any of its songs on YouTube.',
      });
      return;
    }

    const queued = await queueResolvedTracks(
      context,
      resolvedPlaylist.resolvedTracks,
      'prepend',
    );

    if (!queued) {
      return;
    }

    const unresolvedLine =
      resolvedPlaylist.unresolvedTracks.length > 0
        ? ` Skipped **${resolvedPlaylist.unresolvedTracks.length}** unmatched track(s).`
        : '';

    await context.editReply({
      title: 'Queued Next',
      description: `Added **${queued.queuedCount}** track(s) from **${resolvedPlaylist.title}** to the front of the queue.${unresolvedLine}`,
    });
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

  queue.prepend(searchResult.tracks);
  syncQueueTextChannel(context.interaction, queue);

  await context.editReply({
    title: 'Queued Next',
    description:
      searchResult.tracks.length === 1
        ? `[${searchResult.tracks[0].title}](${searchResult.tracks[0].url}) will play next.`
        : `Added **${searchResult.tracks.length}** tracks to the front of the queue.`,
  });
};

export const playCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Start playback now or queue something to play next.')
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('now')
        .setDescription('Play a song or playlist now.')
        .addStringOption((option) =>
          option
            .setName('query')
            .setDescription('A search term or music URL')
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('next')
        .setDescription('Queue a song or playlist right after the current track.')
        .addStringOption((option) =>
          option
            .setName('query')
            .setDescription('A search term or music URL')
            .setRequired(true),
        ),
    ),
  execute: async (context) => {
    const subcommand = context.interaction.options.getSubcommand(true);
    const query = context.interaction.options.getString('query', true);

    if (subcommand === 'next') {
      await queueNext(context, query);
      return;
    }

    await queueNow(context, query);
  },
};

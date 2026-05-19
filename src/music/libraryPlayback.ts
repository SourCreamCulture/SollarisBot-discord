import type { Track } from 'discord-player';

import type { CommandContext } from '../types/bot';
import {
  ensureSameVoiceChannel,
  requireVoiceChannel,
  resolveMember,
  resolveTextChannel,
  syncQueueTextChannel,
} from './guards';
import type { SavedTrack } from './library';
import { getGuildSession, playTrack } from './service';
import { buildSavedTrackPlaybackRequest } from './spotify';

export interface QueueSavedTracksResult {
  queuedCount: number;
  firstTrackTitle: string;
  startedPlayback: boolean;
}

export const queueSavedTracks = async (
  context: CommandContext,
  tracks: SavedTrack[],
): Promise<QueueSavedTracksResult | null> => {
  const voiceChannel = await requireVoiceChannel(context);
  const textChannel = resolveTextChannel(context.interaction);

  if (!voiceChannel || !textChannel) {
    await context.replyError('I can only manage music from a server text channel.');
    return null;
  }

  const existingQueue = getGuildSession(context.player, context.interaction.guildId);

  if (
    existingQueue &&
    !(await ensureSameVoiceChannel(context, existingQueue, voiceChannel))
  ) {
    return null;
  }

  const settings = context.musicSettings.getSettings(context.interaction.guildId);
  const member = await resolveMember(context.interaction);
  let startedPlayback = false;

  for (const [index, track] of tracks.entries()) {
    const playbackRequest = buildSavedTrackPlaybackRequest(context.config, track);
    const result = await playTrack(context.player, context.config, {
      query: playbackRequest.query,
      member,
      voiceChannel,
      textChannel,
      defaultVolume: settings.defaultVolume,
      stayConnected: settings.twentyFourSevenEnabled,
      searchEngine: playbackRequest.searchEngine,
    });

    if (index === 0) {
      startedPlayback = result.startedPlayback;
    }
  }

  return {
    queuedCount: tracks.length,
    firstTrackTitle: tracks[0].title,
    startedPlayback,
  };
};

export const queueResolvedTracks = async (
  context: CommandContext,
  tracks: Track[],
  mode: 'append' | 'prepend' = 'append',
): Promise<QueueSavedTracksResult | null> => {
  if (tracks.length === 0) {
    return null;
  }

  const voiceChannel = await requireVoiceChannel(context);
  const textChannel = resolveTextChannel(context.interaction);

  if (!voiceChannel || !textChannel) {
    await context.replyError('I can only manage music from a server text channel.');
    return null;
  }

  const existingQueue = getGuildSession(context.player, context.interaction.guildId);

  if (
    existingQueue &&
    !(await ensureSameVoiceChannel(context, existingQueue, voiceChannel))
  ) {
    return null;
  }

  const settings = context.musicSettings.getSettings(context.interaction.guildId);
  const member = await resolveMember(context.interaction);
  const queueIsActive = Boolean(
    existingQueue?.currentTrack || existingQueue?.size || existingQueue?.isPlaying(),
  );

  if (!existingQueue || !queueIsActive) {
    const result = await playTrack(context.player, context.config, {
      query: tracks[0].url,
      member,
      voiceChannel,
      textChannel,
      defaultVolume: settings.defaultVolume,
      stayConnected: settings.twentyFourSevenEnabled,
    });

    if (tracks.length > 1) {
      result.queue.addTrack(tracks.slice(1));
      syncQueueTextChannel(context.interaction, result.queue);
    }

    return {
      queuedCount: tracks.length,
      firstTrackTitle: tracks[0].title,
      startedPlayback: result.startedPlayback,
    };
  }

  if (mode === 'prepend') {
    existingQueue.prepend(tracks);
  } else {
    existingQueue.addTrack(tracks);
  }

  syncQueueTextChannel(context.interaction, existingQueue);

  return {
    queuedCount: tracks.length,
    firstTrackTitle: tracks[0].title,
    startedPlayback: false,
  };
};

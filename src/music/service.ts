import ffmpegPath from 'ffmpeg-static';
import { DefaultExtractors } from '@discord-player/extractor';
import {
  GuildQueueEvent,
  Player,
  QueryType,
  QueueRepeatMode,
  type Track,
} from 'discord-player';
import { YoutubeExtractor } from 'discord-player-youtubei';
import type {
  Client,
  GuildTextBasedChannel,
  VoiceBasedChannel,
} from 'discord.js';

import type {
  BotConfig,
  GuildMusicSession,
  MusicMetadata,
  PlayResult,
  PlaybackRequest,
} from '../types/bot';
import type { Logger } from '../utils/logger';
import { createStatusEmbed } from '../utils/embeds';
import { UserFacingError } from '../utils/errors';
import type { SavedTrack } from './library';
import type { GuildMusicSettings } from './settings';
import { buildSavedTrackPlaybackRequest } from './spotify';
import type { VoteSkipManager } from './voteSkip';

const safelySendToChannel = async (
  metadata: MusicMetadata | null | undefined,
  title: string,
  description: string,
  logger: Logger,
) => {
  if (!metadata) {
    return;
  }

  try {
    await metadata.textChannel.send({
      embeds: [createStatusEmbed(title, description)],
    });
  } catch (error) {
    logger.warn('Failed to send a queue update to the text channel.', error);
  }
};

export const createMusicPlayer = async (
  client: Client,
  config: BotConfig,
  logger: Logger,
  voteSkips?: VoteSkipManager,
): Promise<Player> => {
  const player = new Player(client, {
    ffmpegPath: ffmpegPath ?? undefined,
  });

  await player.extractors.loadMulti(DefaultExtractors);
  await player.extractors.register(YoutubeExtractor, {
    disablePlayer: true,
  });

  player.events.on(GuildQueueEvent.PlayerError, async (queue, error, track) => {
    logger.error(
      `Playback error in guild ${queue.guild.id} for ${track.title}: ${error.message}`,
      error,
    );
    await safelySendToChannel(
      queue.metadata,
      'Playback Error',
      `I hit an error while playing **${track.title}**.\n\`${error.message}\``,
      logger,
    );
  });

  player.events.on(GuildQueueEvent.Error, async (queue, error) => {
    logger.error(
      `Queue error in guild ${queue.guild.id}: ${error.message}`,
      error,
    );
    await safelySendToChannel(
      queue.metadata,
      'Queue Error',
      `Something went wrong with the music queue.\n\`${error.message}\``,
      logger,
    );
  });

  player.events.on(GuildQueueEvent.EmptyQueue, async (queue) => {
    logger.info(`Queue ended in guild ${queue.guild.id}.`);
    await safelySendToChannel(
      queue.metadata,
      'Queue Finished',
      `The queue is empty. I'll leave in ${Math.round(
        config.music.leaveOnEndCooldownMs / 1000,
      )} seconds unless something new is queued.`,
      logger,
    );
  });

  player.events.on(GuildQueueEvent.EmptyChannel, async (queue) => {
    logger.info(`Voice channel became empty in guild ${queue.guild.id}.`);
    await safelySendToChannel(
      queue.metadata,
      'Voice Channel Empty',
      `Everybody left the voice channel, so I'll disconnect in ${Math.round(
        config.music.leaveOnEmptyCooldownMs / 1000,
      )} seconds.`,
      logger,
    );
  });

  player.events.on(GuildQueueEvent.Disconnect, (queue) => {
    logger.info(`Disconnected from guild ${queue.guild.id}.`);
  });

  player.events.on(GuildQueueEvent.PlayerStart, (queue) => {
    voteSkips?.clearGuild(queue.guild.id);
  });

  return player;
};

export const getGuildSession = (
  player: Player,
  guildId: string,
): GuildMusicSession | null => player.nodes.get<MusicMetadata>(guildId);

const shouldAutoDetectQuery = (query: string): boolean =>
  /^(https?:\/\/|spotify:)/i.test(query.trim());

const resolvePlaybackSearchEngine = (
  config: BotConfig,
  request: PlaybackRequest,
) =>
  request.searchEngine ??
  (shouldAutoDetectQuery(request.query)
    ? QueryType.AUTO
    : config.music.youtubeSearchEngine);

const buildNodeOptions = (
  config: BotConfig,
  settings: GuildMusicSettings,
  metadata: MusicMetadata,
) => ({
  metadata,
  selfDeaf: true,
  volume: settings.defaultVolume,
  leaveOnEmpty: !settings.twentyFourSevenEnabled,
  leaveOnEmptyCooldown: config.music.leaveOnEmptyCooldownMs,
  leaveOnEnd: !settings.twentyFourSevenEnabled,
  leaveOnEndCooldown: config.music.leaveOnEndCooldownMs,
  leaveOnStop: !settings.twentyFourSevenEnabled,
  leaveOnStopCooldown: config.music.leaveOnStopCooldownMs,
  disableHistory: false,
});

export const applyMusicSettingsToQueue = (
  queue: GuildMusicSession,
  config: BotConfig,
  settings: GuildMusicSettings,
): void => {
  queue.options.leaveOnEmpty = !settings.twentyFourSevenEnabled;
  queue.options.leaveOnEmptyCooldown = config.music.leaveOnEmptyCooldownMs;
  queue.options.leaveOnEnd = !settings.twentyFourSevenEnabled;
  queue.options.leaveOnEndCooldown = config.music.leaveOnEndCooldownMs;
  queue.options.leaveOnStop = !settings.twentyFourSevenEnabled;
  queue.options.leaveOnStopCooldown = config.music.leaveOnStopCooldownMs;
};

export const updateSessionMetadata = (
  queue: GuildMusicSession,
  metadata: MusicMetadata,
): void => {
  queue.setMetadata(metadata);
};

const isQueueActive = (queue: GuildMusicSession | null): boolean =>
  Boolean(queue?.currentTrack) ||
  Boolean(queue?.size) ||
  Boolean(queue?.isPlaying());

export const playTrack = async (
  player: Player,
  config: BotConfig,
  request: PlaybackRequest,
): Promise<PlayResult> => {
  const existingQueue = getGuildSession(player, request.member.guild.id);
  const startedPlayback = !isQueueActive(existingQueue);
  const metadata: MusicMetadata = {
    textChannel: request.textChannel,
    requestedById: request.member.id,
  };
  const settings: GuildMusicSettings = {
    guildId: request.member.guild.id,
    defaultVolume: request.defaultVolume ?? config.music.defaultVolume,
    djRoleId: null,
    textChannelId: request.textChannel.id,
    twentyFourSevenEnabled: request.stayConnected ?? false,
    voteSkipEnabled: true,
    voteSkipThreshold: config.music.voteSkipThreshold,
    updatedAt: new Date().toISOString(),
  };

  const result = await player.play(request.voiceChannel, request.query, {
    requestedBy: request.member.user,
    searchEngine: resolvePlaybackSearchEngine(config, request),
    nodeOptions: buildNodeOptions(config, settings, metadata),
  });

  const queue = result.queue as GuildMusicSession;
  updateSessionMetadata(queue, metadata);
  applyMusicSettingsToQueue(queue, config, settings);

  return {
    queue,
    track: result.track,
    searchResult: result.searchResult,
    startedPlayback,
  };
};

export const describeRepeatMode = (mode: number): string => {
  switch (mode) {
    case QueueRepeatMode.TRACK:
      return 'Track';
    case QueueRepeatMode.QUEUE:
      return 'Queue';
    case QueueRepeatMode.AUTOPLAY:
      return 'Autoplay';
    case QueueRepeatMode.OFF:
    default:
      return 'Off';
  }
};

export const formatTrackLine = (track: Track, index?: number): string => {
  const prefix = typeof index === 'number' ? `**${index}.** ` : '';
  return `${prefix}[${track.title}](${track.url}) • \`${track.duration}\` • requested by ${
    track.requestedBy?.toString() ?? 'Unknown user'
  }`;
};

export const ensureConnectedSession = async (
  player: Player,
  config: BotConfig,
  voiceChannel: VoiceBasedChannel,
  textChannel: GuildTextBasedChannel,
  settings: GuildMusicSettings,
): Promise<GuildMusicSession> => {
  const clientUserId = player.client.user?.id;

  if (!clientUserId) {
    throw new UserFacingError('Bot user is not ready yet.');
  }

  const queue =
    getGuildSession(player, voiceChannel.guild.id) ??
    (player.nodes.create(voiceChannel.guild, {
      ...buildNodeOptions(config, settings, {
        textChannel,
        requestedById: clientUserId,
      }),
    }) as GuildMusicSession);

  updateSessionMetadata(queue, {
    textChannel,
    requestedById: clientUserId,
  });
  applyMusicSettingsToQueue(queue, config, settings);

  if (!queue.channel) {
    await queue.connect(voiceChannel);
  }

  if (queue.node.volume !== settings.defaultVolume) {
    queue.node.setVolume(settings.defaultVolume);
  }

  return queue;
};

export const restoreSavedQueue = async (
  player: Player,
  config: BotConfig,
  settings: GuildMusicSettings,
  voiceChannel: VoiceBasedChannel,
  textChannel: GuildTextBasedChannel,
  state: {
    currentTrack: SavedTrack | null;
    upcomingTracks: SavedTrack[];
    volume: number;
    repeatMode: number;
  },
): Promise<void> => {
  const clientUser = player.client.user;

  if (!clientUser) {
    throw new UserFacingError('Bot user is not ready yet.');
  }

  if (state.currentTrack) {
    const playbackRequest = buildSavedTrackPlaybackRequest(
      config,
      state.currentTrack,
    );
    await player.play(voiceChannel, playbackRequest.query, {
      requestedBy: clientUser,
      searchEngine: playbackRequest.searchEngine,
      nodeOptions: buildNodeOptions(config, settings, {
        textChannel,
        requestedById: clientUser.id,
      }),
    });
  } else if (settings.twentyFourSevenEnabled) {
    await ensureConnectedSession(
      player,
      config,
      voiceChannel,
      textChannel,
      settings,
    );
  }

  const queue = getGuildSession(player, voiceChannel.guild.id);

  if (!queue) {
    return;
  }

  for (const track of state.upcomingTracks) {
    const playbackRequest = buildSavedTrackPlaybackRequest(config, track);
    await player.play(voiceChannel, playbackRequest.query, {
      requestedBy: clientUser,
      searchEngine: playbackRequest.searchEngine,
    });
  }

  queue.node.setVolume(state.volume);
  queue.setRepeatMode(state.repeatMode as QueueRepeatMode);
  applyMusicSettingsToQueue(queue, config, settings);
};

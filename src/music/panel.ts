import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  GuildMember,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ColorResolvable,
  type Interaction,
  type TextBasedChannel,
} from 'discord.js';
import { QueueRepeatMode, type Player } from 'discord-player';

import type { GuildMusicSession } from '../types/bot';
import {
  describeRepeatMode,
  formatTrackLine,
  getGuildSession,
} from './service';
import type { Logger } from '../utils/logger';
import { createQueueSnapshot, type QueueStateService } from './queueState';
import type { MusicSettingsService } from './settings';
import { createSavedTrack, type MusicLibraryService } from './library';
import type { VoteSkipManager } from './voteSkip';

const CONTROL_PREFIX = 'music-control:';
const SAVE_PLAYLIST_MODAL_PREFIX = 'music-save-playlist:';
const QUEUE_PREVIEW_SIZE = 5;
const QUEUE_SNAPSHOT_SIZE = 10;
const HISTORY_PREVIEW_SIZE = 3;
const VOLUME_STEP = 10;
const EMBED_FIELD_LIMIT = 1024;

type ControlAction =
  | 'autoplay'
  | 'back'
  | 'loop'
  | 'queue'
  | 'queue-again'
  | 'refresh'
  | 'replay'
  | 'save-playlist'
  | 'favorite'
  | 'shuffle'
  | 'skip'
  | 'stop'
  | 'toggle'
  | 'voteskip'
  | 'vol-down'
  | 'vol-up';

interface PanelRef {
  channelId: string;
  messageId: string;
}

const getStatusColor = (queue: GuildMusicSession): ColorResolvable => {
  if (!queue.currentTrack) {
    return 0x7f8c8d;
  }

  return queue.node.isPaused() ? 0xf39c12 : 0x4f9eed;
};

const clampVolume = (volume: number): number =>
  Math.min(100, Math.max(1, volume));

const limitFieldValue = (value: string): string =>
  value.length > EMBED_FIELD_LIMIT
    ? `${value.slice(0, EMBED_FIELD_LIMIT - 3)}...`
    : value;

const formatQueueDuration = (queue: GuildMusicSession): string =>
  queue.durationFormatted && queue.durationFormatted !== '0:00'
    ? queue.durationFormatted
    : 'Unknown';

const formatTrackSource = (queue: GuildMusicSession): string => {
  const source = queue.currentTrack?.source;

  return typeof source === 'string' && source.length > 0 ? source : 'Unknown';
};

const getNextRepeatMode = (queue: GuildMusicSession): QueueRepeatMode => {
  switch (queue.repeatMode) {
    case QueueRepeatMode.TRACK:
      return QueueRepeatMode.QUEUE;
    case QueueRepeatMode.QUEUE:
      return QueueRepeatMode.OFF;
    case QueueRepeatMode.OFF:
    case QueueRepeatMode.AUTOPLAY:
    default:
      return QueueRepeatMode.TRACK;
  }
};

const buildPlaybackControlRow = (
  queue: GuildMusicSession,
  disabled = false,
) => {
  const paused = queue.node.isPaused();
  const hasTrack = Boolean(queue.currentTrack);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CONTROL_PREFIX}back`)
      .setLabel('Back')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || queue.history.isEmpty()),
    new ButtonBuilder()
      .setCustomId(`${CONTROL_PREFIX}replay`)
      .setLabel('Replay')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || !queue.currentTrack?.seekable),
    new ButtonBuilder()
      .setCustomId(`${CONTROL_PREFIX}toggle`)
      .setLabel(paused ? 'Resume' : 'Pause')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled || !hasTrack),
    new ButtonBuilder()
      .setCustomId(`${CONTROL_PREFIX}skip`)
      .setLabel('Skip')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || !hasTrack),
    new ButtonBuilder()
      .setCustomId(`${CONTROL_PREFIX}stop`)
      .setLabel('Stop')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled || (!queue.currentTrack && queue.size === 0)),
  );
};

const buildModeControlRow = (queue: GuildMusicSession, disabled = false) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CONTROL_PREFIX}vol-down`)
      .setLabel('Vol -')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || queue.node.volume <= 1),
    new ButtonBuilder()
      .setCustomId(`${CONTROL_PREFIX}vol-up`)
      .setLabel('Vol +')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || queue.node.volume >= 100),
    new ButtonBuilder()
      .setCustomId(`${CONTROL_PREFIX}loop`)
      .setLabel(`Repeat: ${describeRepeatMode(queue.repeatMode)}`)
      .setStyle(
        queue.repeatMode === QueueRepeatMode.OFF
          ? ButtonStyle.Secondary
          : ButtonStyle.Primary,
      )
      .setDisabled(disabled || (!queue.currentTrack && queue.size === 0)),
    new ButtonBuilder()
      .setCustomId(`${CONTROL_PREFIX}shuffle`)
      .setLabel(queue.isShuffling ? 'Shuffle: On' : 'Shuffle: Off')
      .setStyle(queue.isShuffling ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(disabled || queue.size < 2),
    new ButtonBuilder()
      .setCustomId(`${CONTROL_PREFIX}autoplay`)
      .setLabel(
        queue.repeatMode === QueueRepeatMode.AUTOPLAY
          ? 'Autoplay: On'
          : 'Autoplay: Off',
      )
      .setStyle(
        queue.repeatMode === QueueRepeatMode.AUTOPLAY
          ? ButtonStyle.Primary
          : ButtonStyle.Secondary,
      )
      .setDisabled(disabled || !queue.currentTrack),
  );

const buildUtilityControlRow = (queue: GuildMusicSession, disabled = false) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CONTROL_PREFIX}favorite`)
      .setLabel('Favorite')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || !queue.currentTrack),
    new ButtonBuilder()
      .setCustomId(`${CONTROL_PREFIX}voteskip`)
      .setLabel('Vote Skip')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || !queue.currentTrack),
    new ButtonBuilder()
      .setCustomId(`${CONTROL_PREFIX}queue-again`)
      .setLabel('Queue Again')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || !queue.currentTrack),
    new ButtonBuilder()
      .setCustomId(`${CONTROL_PREFIX}save-playlist`)
      .setLabel('Save Playlist')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || !queue.currentTrack),
    new ButtonBuilder()
      .setCustomId(`${CONTROL_PREFIX}queue`)
      .setLabel('Queue')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || (!queue.currentTrack && queue.size === 0)),
  );

const buildRefreshControlRow = (disabled = false) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CONTROL_PREFIX}refresh`)
      .setLabel('Refresh')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );

const buildControlRows = (queue: GuildMusicSession, disabled = false) => {
  return [
    buildPlaybackControlRow(queue, disabled),
    buildModeControlRow(queue, disabled),
    buildUtilityControlRow(queue, disabled),
    buildRefreshControlRow(disabled),
  ];
};

const buildPanelEmbed = (queue: GuildMusicSession): EmbedBuilder => {
  const current = queue.currentTrack;
  const upcoming = queue.tracks.toArray().slice(0, QUEUE_PREVIEW_SIZE);
  const previous = queue.history.tracks
    .toArray()
    .slice(-HISTORY_PREVIEW_SIZE)
    .reverse();
  const progressBar = current
    ? queue.node.createProgressBar({
        indicator: '[]',
        leftChar: '=',
        rightChar: '-',
      })
    : null;
  const timestamp = current ? queue.node.getTimestamp() : null;
  const status = !current
    ? 'Idle'
    : queue.node.isPaused()
      ? 'Paused'
      : 'Playing';

  const description = current
    ? [
        `**[${current.title}](${current.url})**`,
        '',
        progressBar ?? '`Progress unavailable`',
        timestamp
          ? `Elapsed: \`${timestamp.current.label}\` / \`${timestamp.total.label}\``
          : `Duration: \`${current.duration}\``,
        `Artist/source: \`${current.author || formatTrackSource(queue)}\``,
        `Requested by: ${current.requestedBy?.toString() ?? 'Unknown user'}`,
      ].join('\n')
    : 'No track is currently playing.';

  const embed = new EmbedBuilder()
    .setColor(getStatusColor(queue))
    .setTitle('Music Panel')
    .setDescription(description)
    .setTimestamp()
    .addFields(
      {
        name: 'Status',
        value: `\`${status}\``,
        inline: true,
      },
      {
        name: 'Repeat',
        value: `\`${describeRepeatMode(queue.repeatMode)}\``,
        inline: true,
      },
      {
        name: 'Volume',
        value: `\`${queue.node.volume}%\``,
        inline: true,
      },
      {
        name: 'Queue',
        value: `\`${queue.size} upcoming\``,
        inline: true,
      },
      {
        name: 'Shuffle',
        value: queue.isShuffling ? '`On`' : '`Off`',
        inline: true,
      },
      {
        name: 'Total Time',
        value: `\`${formatQueueDuration(queue)}\``,
        inline: true,
      },
    );

  if (current?.thumbnail) {
    embed.setThumbnail(current.thumbnail);
  }

  if (upcoming.length > 0) {
    embed.addFields({
      name: 'Up Next',
      value: limitFieldValue(
        upcoming
          .map((track, index) => formatTrackLine(track, index + 1))
          .join('\n'),
      ),
    });
  } else {
    embed.addFields({
      name: 'Up Next',
      value: 'No upcoming tracks queued.',
    });
  }

  if (previous.length > 0) {
    embed.addFields({
      name: 'Recently Played',
      value: limitFieldValue(
        previous
          .map((track, index) => formatTrackLine(track, index + 1))
          .join('\n'),
      ),
    });
  }

  return embed;
};

const buildQueueEmbed = (queue: GuildMusicSession): EmbedBuilder => {
  const upcoming = queue.tracks.toArray().slice(0, QUEUE_SNAPSHOT_SIZE);
  const previous = queue.history.tracks
    .toArray()
    .slice(-HISTORY_PREVIEW_SIZE)
    .reverse();
  const queueRemainder = Math.max(0, queue.size - upcoming.length);

  const embed = new EmbedBuilder()
    .setColor(0x4f9eed)
    .setTitle('Queue Snapshot')
    .setDescription(
      queue.currentTrack
        ? `Now playing: ${formatTrackLine(queue.currentTrack)}`
        : 'Nothing is currently playing.',
    )
    .addFields(
      {
        name: 'Stats',
        value: [
          `Status: \`${queue.node.isPaused() ? 'Paused' : 'Playing'}\``,
          `Repeat: \`${describeRepeatMode(queue.repeatMode)}\``,
          `Shuffle: \`${queue.isShuffling ? 'On' : 'Off'}\``,
          `Volume: \`${queue.node.volume}%\``,
          `Total time: \`${formatQueueDuration(queue)}\``,
        ].join('\n'),
      },
      {
        name:
          queueRemainder > 0
            ? `Upcoming (${queueRemainder} more not shown)`
            : 'Upcoming',
        value:
          upcoming.length > 0
            ? limitFieldValue(
                upcoming
                  .map((track, index) => formatTrackLine(track, index + 1))
                  .join('\n'),
              )
            : 'No upcoming tracks queued.',
      },
    )
    .setTimestamp();

  if (previous.length > 0) {
    embed.addFields({
      name: 'Recently Played',
      value: limitFieldValue(
        previous
          .map((track, index) => formatTrackLine(track, index + 1))
          .join('\n'),
      ),
    });
  }

  return embed;
};

export class MusicPanelManager {
  private readonly panels = new Map<string, PanelRef>();

  constructor(
    private readonly player: Player,
    private readonly logger: Logger,
    private readonly queueState: QueueStateService,
    private readonly musicSettings?: MusicSettingsService,
  ) {}

  private shouldPersistPanelRef(guildId: string): boolean {
    return (
      this.musicSettings?.getSettings(guildId).panelPersistenceEnabled ?? true
    );
  }

  private getPanelRef(guildId: string): PanelRef | undefined {
    const inMemoryPanel = this.panels.get(guildId);

    if (inMemoryPanel) {
      return inMemoryPanel;
    }

    if (!this.shouldPersistPanelRef(guildId)) {
      return undefined;
    }

    const restoredPanel = this.queueState.get(guildId)?.panelMessage;

    if (restoredPanel) {
      this.panels.set(guildId, restoredPanel);
    }

    return restoredPanel;
  }

  private async persistPanelRef(
    queue: GuildMusicSession,
    panel: PanelRef,
  ): Promise<void> {
    this.panels.set(queue.guild.id, panel);

    if (!this.shouldPersistPanelRef(queue.guild.id)) {
      return;
    }

    try {
      const snapshot = createQueueSnapshot(queue);

      if (snapshot) {
        snapshot.panelMessage = panel;
        await this.queueState.save(snapshot);
      }
    } catch (error) {
      this.logger.warn('Failed to persist the music panel message.', error);
    }
  }

  private async cleanupPanelRef(panel: PanelRef): Promise<void> {
    try {
      const channel = await this.player.client.channels.fetch(panel.channelId);

      if (!channel?.isTextBased()) {
        return;
      }

      const textChannel = channel as TextBasedChannel & {
        messages: { fetch(messageId: string): Promise<{ delete(): unknown }> };
      };
      const message = await textChannel.messages.fetch(panel.messageId);
      await message.delete();
    } catch (error) {
      this.logger.debug('Music panel cleanup skipped.', error);
    }
  }

  async render(queue: GuildMusicSession): Promise<void> {
    const channel = queue.metadata?.textChannel;

    if (!channel) {
      return;
    }

    const panel = this.getPanelRef(queue.guild.id);
    const payload = {
      embeds: [buildPanelEmbed(queue)],
      components: buildControlRows(queue),
    };

    if (panel) {
      if (panel.channelId === channel.id) {
        try {
          const existing = await channel.messages.fetch(panel.messageId);
          await existing.edit(payload);
          await this.persistPanelRef(queue, panel);
          return;
        } catch (error) {
          this.logger.warn(
            'Failed to edit existing music panel, sending a new one.',
            error,
          );
          await this.cleanupPanelRef(panel);
        }
      } else {
        await this.cleanupPanelRef(panel);
      }
    }

    const message = await channel.send(payload);
    await this.persistPanelRef(queue, {
      channelId: message.channelId,
      messageId: message.id,
    });
  }

  async disable(queue: GuildMusicSession, message: string): Promise<void> {
    const panel = this.getPanelRef(queue.guild.id);

    if (!panel) {
      return;
    }

    try {
      const channel = queue.metadata?.textChannel;

      if (!channel) {
        return;
      }

      const existing = await channel.messages.fetch(panel.messageId);
      const embed = buildPanelEmbed(queue).setTitle('Music Panel').addFields({
        name: 'Session Update',
        value: message,
      });
      await existing.edit({
        embeds: [embed],
        components: buildControlRows(queue, true),
      });
    } catch (error) {
      this.logger.warn('Failed to disable the music panel message.', error);
    } finally {
      this.panels.delete(queue.guild.id);
    }
  }

  async handleButton(
    interaction: Interaction,
    musicSettings: MusicSettingsService,
    musicLibrary: MusicLibraryService,
    voteSkips: VoteSkipManager,
  ): Promise<boolean> {
    if (
      interaction.isModalSubmit() &&
      interaction.inCachedGuild() &&
      interaction.customId.startsWith(SAVE_PLAYLIST_MODAL_PREFIX)
    ) {
      const queue = getGuildSession(this.player, interaction.guildId);
      const track = queue?.currentTrack;

      if (!queue || !track) {
        await interaction.reply({
          content: 'There is no current track to save.',
          ephemeral: true,
        });
        return true;
      }

      const playlistName = interaction.fields
        .getTextInputValue('playlist-name')
        .trim();

      if (!playlistName) {
        await interaction.reply({
          content: 'Playlist names need at least one letter or number.',
          ephemeral: true,
        });
        return true;
      }

      let playlist = musicLibrary.getPlaylist(
        interaction.guildId,
        playlistName,
      );

      if (!playlist) {
        playlist = await musicLibrary.createPlaylist(
          interaction.guildId,
          playlistName,
          interaction.user.id,
        );
      }

      const updated = await musicLibrary.addPlaylistTrack(
        interaction.guildId,
        playlist.name,
        createSavedTrack(track, interaction.user.id),
      );

      await interaction.reply({
        content: `Saved **${track.title}** to **${updated.name}**.`,
        ephemeral: true,
      });
      return true;
    }

    if (
      !interaction.isButton() ||
      !interaction.inCachedGuild() ||
      !interaction.customId.startsWith(CONTROL_PREFIX)
    ) {
      return false;
    }

    const action = interaction.customId.slice(
      CONTROL_PREFIX.length,
    ) as ControlAction;
    const queue = getGuildSession(this.player, interaction.guildId);

    if (!queue) {
      await interaction.reply({
        content: 'There is no active music session right now.',
        ephemeral: true,
      });
      return true;
    }

    const settings = musicSettings.getSettings(interaction.guildId);

    if (
      settings.textChannelId &&
      settings.textChannelId !== interaction.channelId
    ) {
      await interaction.reply({
        content: `Music controls are bound to <#${settings.textChannelId}> in this server.`,
        ephemeral: true,
      });
      return true;
    }

    const member = interaction.member;
    if (!(member instanceof GuildMember)) {
      await interaction.reply({
        content: 'I could not resolve your server member data.',
        ephemeral: true,
      });
      return true;
    }

    const voiceChannel = member.voice.channel;

    if (!voiceChannel || !voiceChannel.isVoiceBased()) {
      await interaction.reply({
        content:
          'You need to join a voice channel before using music controls.',
        ephemeral: true,
      });
      return true;
    }

    if (queue.channel && queue.channel.id !== voiceChannel.id) {
      await interaction.reply({
        content: `You need to be in ${queue.channel.toString()} with me to use this control.`,
        ephemeral: true,
      });
      return true;
    }

    if (
      settings.djRoleId &&
      !member.permissions.has(PermissionFlagsBits.ManageGuild) &&
      !member.roles.cache.has(settings.djRoleId) &&
      action !== 'queue' &&
      action !== 'refresh'
    ) {
      await interaction.reply({
        content: `Only members with the <@&${settings.djRoleId}> role can use this control.`,
        ephemeral: true,
      });
      return true;
    }

    if (action === 'queue') {
      await interaction.reply({
        embeds: [buildQueueEmbed(queue)],
        ephemeral: true,
      });
      return true;
    }

    if (action === 'save-playlist') {
      const modal = new ModalBuilder()
        .setCustomId(`${SAVE_PLAYLIST_MODAL_PREFIX}${interaction.user.id}`)
        .setTitle('Save Current Track')
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId('playlist-name')
              .setLabel('Playlist name')
              .setStyle(TextInputStyle.Short)
              .setMinLength(1)
              .setMaxLength(50)
              .setRequired(true),
          ),
        );

      await interaction.showModal(modal);
      return true;
    }

    if (action === 'favorite') {
      const track = queue.currentTrack;

      if (!track) {
        await interaction.reply({
          content: 'There is no current track to favorite.',
          ephemeral: true,
        });
        return true;
      }

      await musicLibrary.addFavorite(
        interaction.user.id,
        createSavedTrack(track, interaction.user.id),
      );
      await interaction.reply({
        content: `Saved **${track.title}** to your favorites.`,
        ephemeral: true,
      });
      return true;
    }

    if (action === 'voteskip') {
      const track = queue.currentTrack;

      if (!track) {
        await interaction.reply({
          content: 'There is no current track to vote skip.',
          ephemeral: true,
        });
        return true;
      }

      if (!settings.voteSkipEnabled) {
        await interaction.reply({
          content: 'Vote skip is disabled in this server.',
          ephemeral: true,
        });
        return true;
      }

      const eligibleVoters = voiceChannel.members.filter(
        (voiceMember) => !voiceMember.user.bot,
      ).size;
      const result = voteSkips.registerVote({
        guildId: interaction.guildId,
        track,
        voterId: interaction.user.id,
        eligibleVoters,
        threshold: settings.voteSkipThreshold,
      });

      if (!result.passed) {
        await interaction.reply({
          content: `Vote recorded for **${track.title}**. Current votes: **${result.votes}/${result.requiredVotes}**.`,
          ephemeral: true,
        });
        return true;
      }

      queue.node.skip();
      voteSkips.clearGuild(interaction.guildId);
      await interaction.reply({
        content: `Vote passed: **${result.votes}/${result.requiredVotes}**. Skipped **${track.title}**.`,
        ephemeral: true,
      });
      await this.render(queue);
      return true;
    }

    if (action === 'refresh') {
      await interaction.deferUpdate();
      await this.render(queue);
      return true;
    }

    if (!queue.currentTrack && action !== 'stop') {
      await interaction.reply({
        content: 'There is no current track for that control.',
        ephemeral: true,
      });
      return true;
    }

    await interaction.deferUpdate();
    let notice: string | null = null;

    switch (action) {
      case 'autoplay':
        queue.setRepeatMode(
          queue.repeatMode === QueueRepeatMode.AUTOPLAY
            ? QueueRepeatMode.OFF
            : QueueRepeatMode.AUTOPLAY,
        );
        break;
      case 'back':
        try {
          await queue.history.back();
        } catch (error) {
          this.logger.warn('Failed to play the previous track.', error);
          notice = 'I could not play the previous track.';
        }
        break;
      case 'loop':
        queue.setRepeatMode(getNextRepeatMode(queue));
        break;
      case 'replay':
        if (!queue.currentTrack?.seekable) {
          notice = 'This track cannot be replayed.';
          break;
        }

        if (!(await queue.node.seek(0))) {
          notice = 'I could not replay the current track.';
        }
        break;
      case 'queue-again':
        if (queue.currentTrack) {
          queue.addTrack(queue.currentTrack);
        }
        break;
      case 'shuffle':
        queue.toggleShuffle(true);
        break;
      case 'toggle':
        if (queue.node.isPaused()) {
          queue.node.resume();
        } else {
          queue.node.pause();
        }
        break;
      case 'skip':
        if (!queue.node.skip()) {
          notice = 'I could not skip the current track.';
        }
        break;
      case 'stop':
        queue.clear();
        queue.setRepeatMode(QueueRepeatMode.OFF);
        queue.node.stop();
        await this.queueState.clear(interaction.guildId);
        break;
      case 'vol-down':
        if (
          !queue.node.setVolume(clampVolume(queue.node.volume - VOLUME_STEP))
        ) {
          notice = 'I could not lower the volume.';
        }
        break;
      case 'vol-up':
        if (
          !queue.node.setVolume(clampVolume(queue.node.volume + VOLUME_STEP))
        ) {
          notice = 'I could not raise the volume.';
        }
        break;
      default:
        break;
    }

    if (action !== 'stop') {
      const snapshot = createQueueSnapshot(queue);
      if (snapshot) {
        await this.queueState.save(snapshot);
      }
    }

    await this.render(queue);

    if (notice) {
      await interaction.followUp({
        content: notice,
        ephemeral: true,
      });
    }

    return true;
  }
}

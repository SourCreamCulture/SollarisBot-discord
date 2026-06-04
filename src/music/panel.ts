import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  GuildMember,
  PermissionFlagsBits,
  type ColorResolvable,
  type Interaction,
} from 'discord.js';
import type { Player } from 'discord-player';

import type { GuildMusicSession } from '../types/bot';
import {
  describeRepeatMode,
  formatTrackLine,
  getGuildSession,
} from './service';
import type { Logger } from '../utils/logger';
import { createQueueSnapshot, type QueueStateService } from './queueState';
import type { MusicSettingsService } from './settings';

const CONTROL_PREFIX = 'music-control:';

type ControlAction = 'toggle' | 'skip' | 'stop' | 'queue';

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

const buildControlRow = (queue: GuildMusicSession, disabled = false) => {
  const paused = queue.node.isPaused();

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CONTROL_PREFIX}toggle`)
      .setLabel(paused ? 'Resume' : 'Pause')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled || !queue.currentTrack),
    new ButtonBuilder()
      .setCustomId(`${CONTROL_PREFIX}skip`)
      .setLabel('Skip')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || !queue.currentTrack),
    new ButtonBuilder()
      .setCustomId(`${CONTROL_PREFIX}stop`)
      .setLabel('Stop')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled || (!queue.currentTrack && queue.size === 0)),
    new ButtonBuilder()
      .setCustomId(`${CONTROL_PREFIX}queue`)
      .setLabel('Queue')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || (!queue.currentTrack && queue.size === 0)),
  );
};

const buildPanelEmbed = (queue: GuildMusicSession): EmbedBuilder => {
  const current = queue.currentTrack;
  const upcoming = queue.tracks.toArray().slice(0, 3);
  const progressBar = current ? queue.node.createProgressBar() : null;
  const timestamp = current ? queue.node.getTimestamp() : null;
  const status = !current
    ? 'Idle'
    : queue.node.isPaused()
      ? 'Paused'
      : 'Playing';

  const description = current
    ? [
        `[${current.title}](${current.url})`,
        '',
        progressBar ?? '`Progress unavailable`',
        timestamp
          ? `Elapsed: \`${timestamp.current.label}\` / \`${timestamp.total.label}\``
          : `Duration: \`${current.duration}\``,
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
    );

  if (current?.thumbnail) {
    embed.setThumbnail(current.thumbnail);
  }

  if (upcoming.length > 0) {
    embed.addFields({
      name: 'Up Next',
      value: upcoming
        .map((track, index) => formatTrackLine(track, index + 1))
        .join('\n'),
    });
  } else {
    embed.addFields({
      name: 'Up Next',
      value: 'No upcoming tracks queued.',
    });
  }

  return embed;
};

const buildQueueEmbed = (queue: GuildMusicSession): EmbedBuilder => {
  const upcoming = queue.tracks.toArray().slice(0, 10);

  return new EmbedBuilder()
    .setColor(0x4f9eed)
    .setTitle('Queue Snapshot')
    .setDescription(
      queue.currentTrack
        ? `Now playing: ${formatTrackLine(queue.currentTrack)}`
        : 'Nothing is currently playing.',
    )
    .addFields({
      name: 'Upcoming',
      value:
        upcoming.length > 0
          ? upcoming
              .map((track, index) => formatTrackLine(track, index + 1))
              .join('\n')
          : 'No upcoming tracks queued.',
    })
    .setTimestamp();
};

export class MusicPanelManager {
  private readonly panels = new Map<string, PanelRef>();

  constructor(
    private readonly player: Player,
    private readonly logger: Logger,
    private readonly queueState: QueueStateService,
  ) {}

  async render(queue: GuildMusicSession): Promise<void> {
    const channel = queue.metadata?.textChannel;

    if (!channel) {
      return;
    }

    const panel = this.panels.get(queue.guild.id);
    const payload = {
      embeds: [buildPanelEmbed(queue)],
      components: [buildControlRow(queue)],
    };

    try {
      if (panel && panel.channelId === channel.id) {
        const existing = await channel.messages.fetch(panel.messageId);
        await existing.edit(payload);
        return;
      }
    } catch (error) {
      this.logger.warn(
        'Failed to edit existing music panel, sending a new one.',
        error,
      );
    }

    const message = await channel.send(payload);
    this.panels.set(queue.guild.id, {
      channelId: message.channelId,
      messageId: message.id,
    });
  }

  async disable(queue: GuildMusicSession, message: string): Promise<void> {
    const panel = this.panels.get(queue.guild.id);

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
        components: [buildControlRow(queue, true)],
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
  ): Promise<boolean> {
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
      action !== 'queue'
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

    if (!queue.currentTrack && action !== 'stop') {
      await interaction.reply({
        content: 'There is no current track for that control.',
        ephemeral: true,
      });
      return true;
    }

    await interaction.deferUpdate();

    switch (action) {
      case 'toggle':
        if (queue.node.isPaused()) {
          queue.node.resume();
        } else {
          queue.node.pause();
        }
        {
          const snapshot = createQueueSnapshot(queue);
          if (snapshot) {
            await this.queueState.save(snapshot);
          }
        }
        break;
      case 'skip':
        queue.node.skip();
        {
          const snapshot = createQueueSnapshot(queue);
          if (snapshot) {
            await this.queueState.save(snapshot);
          }
        }
        break;
      case 'stop':
        queue.clear();
        queue.node.stop();
        await this.queueState.clear(interaction.guildId);
        break;
      default:
        break;
    }

    await this.render(queue);
    return true;
  }
}

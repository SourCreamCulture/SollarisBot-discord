import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  type MessageEditOptions,
  type Client,
  type Interaction,
} from 'discord.js';

import type {
  SavedEvent,
  SavedPoll,
  SavedReminder,
  SavedLfg,
  UtilityStore,
} from './utilityStore';
import type { Logger } from './logger';
import { UserFacingError } from './errors';
import { restrictionError } from './guildPermissions';

const POLL_PREFIX = 'poll-vote:';
const LFG_PREFIX = 'lfg:';
const EVENT_RSVP_PREFIX = 'event-rsvp:';
const REMINDER_POLL_INTERVAL_MS = 30_000;

const formatTimestamp = (iso: string, style: 'f' | 'R' = 'f'): string =>
  `<t:${Math.floor(new Date(iso).getTime() / 1000)}:${style}>`;

const countPollVotes = (poll: SavedPoll): number[] => {
  const counts = Array.from({ length: poll.options.length }, () => 0);

  for (const optionIndex of Object.values(poll.votes)) {
    if (counts[optionIndex] !== undefined) {
      counts[optionIndex] += 1;
    }
  }

  return counts;
};

export const buildPollPayload = (poll: SavedPoll) => {
  const counts = countPollVotes(poll);
  const totalVotes = counts.reduce((total, count) => total + count, 0);
  const embed = new EmbedBuilder()
    .setColor(0x4f9eed)
    .setTitle('Poll')
    .setDescription(`**${poll.question}**`)
    .addFields(
      poll.options.map((option, index) => {
        const count = counts[index] ?? 0;
        const percent =
          totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;

        return {
          name: `${index + 1}. ${option}`,
          value: `Votes: **${count}** (${percent}%)`,
          inline: true,
        };
      }),
    )
    .setFooter({ text: `${totalVotes} vote(s)` })
    .setTimestamp(new Date(poll.createdAt));
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    poll.options.map((option, index) =>
      new ButtonBuilder()
        .setCustomId(`${POLL_PREFIX}${poll.id}:${index}`)
        .setLabel(String(index + 1))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!option),
    ),
  );

  return {
    embeds: [embed],
    components: [row],
    allowedMentions: { parse: [] as [] },
  };
};

export const buildEventPayload = (event: SavedEvent) => {
  const attendeeText =
    event.attendees.length > 0
      ? event.attendees.map((userId) => `<@${userId}>`).join(', ')
      : 'No RSVPs yet.';
  const embed = new EmbedBuilder()
    .setColor(0x53d769)
    .setTitle(`${event.cancelled ? '[Cancelled] ' : ''}${event.title}`)
    .setDescription(
      [
        `Starts ${formatTimestamp(event.startsAt)} (${formatTimestamp(event.startsAt, 'R')})`,
      ].join('\n'),
    )
    .addFields({
      name: `RSVPs (${event.attendees.length}${event.capacity ? `/${event.capacity}` : ''})`,
      value: attendeeText.slice(0, 1024),
    })
    .setFooter({
      text: `ID: ${event.id} · Reminder: ${event.reminderMinutes ?? 15} min before start`,
    })
    .setTimestamp(new Date(event.createdAt));
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${EVENT_RSVP_PREFIX}${event.id}`)
      .setLabel('RSVP')
      .setStyle(ButtonStyle.Success)
      .setDisabled(
        Boolean(event.cancelled) || Date.parse(event.startsAt) <= Date.now(),
      ),
  );

  return {
    embeds: [embed],
    components: [row],
    allowedMentions: { parse: [] as [] },
  };
};

export const buildLfgPayload = (lfg: SavedLfg) => {
  const expired = Date.parse(lfg.expiresAt) <= Date.now();
  const inactive = lfg.closed || expired;
  const slots = Math.max(0, lfg.capacity - lfg.participants.length);
  const embed = new EmbedBuilder()
    .setColor(lfg.game === 'valorant' ? 0xff4655 : 0xe85d3f)
    .setTitle(
      `${lfg.game === 'valorant' ? 'Valorant' : 'Apex Legends'} LFG${inactive ? ' · Closed' : ''}`,
    )
    .setDescription(lfg.description.slice(0, 3500))
    .addFields(
      { name: 'Host', value: `<@${lfg.createdById}>` },
      {
        name: 'Squad',
        value: lfg.participants.map((id) => `<@${id}>`).join(', '),
      },
      {
        name: 'Open slots',
        value: `${slots} (${lfg.participants.length}/${lfg.capacity})`,
        inline: true,
      },
      {
        name: 'Expires',
        value: formatTimestamp(lfg.expiresAt, 'R'),
        inline: true,
      },
    )
    .setFooter({ text: `ID: ${lfg.id}` });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${LFG_PREFIX}${lfg.id}:join`)
      .setLabel('Join')
      .setStyle(ButtonStyle.Success)
      .setDisabled(inactive || slots === 0),
    new ButtonBuilder()
      .setCustomId(`${LFG_PREFIX}${lfg.id}:leave`)
      .setLabel('Leave')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(inactive),
    new ButtonBuilder()
      .setCustomId(`${LFG_PREFIX}${lfg.id}:close`)
      .setLabel('Close')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(inactive),
  );
  return {
    embeds: [embed],
    components: [row],
    allowedMentions: { parse: [] as [] },
  };
};

export const refreshUtilityMessage = async (
  client: Client,
  record: { guildId: string; channelId: string; messageId?: string },
  payload: MessageEditOptions,
  logger: Logger,
): Promise<boolean> => {
  if (!record.messageId) return false;
  try {
    const channel = await client.channels.fetch(record.channelId);
    if (
      !channel?.isTextBased() ||
      !('guildId' in channel) ||
      channel.guildId !== record.guildId
    )
      return false;
    const message = await channel.messages.fetch(record.messageId);
    await message.edit(payload);
    return true;
  } catch (error) {
    logger.warn('Failed to update utility message.', error);
    return false;
  }
};

export class UtilityInteractionManager {
  private reminderTimer: ReturnType<typeof globalThis.setInterval> | null =
    null;
  private tickPromise: Promise<void> | null = null;
  private readonly interactionChains = new Map<string, Promise<void>>();

  constructor(
    private readonly store: UtilityStore,
    private readonly logger: Logger,
  ) {}

  startReminderLoop(client: Client): void {
    if (this.reminderTimer) return;
    const tick = () => {
      void this.tick(client).catch((error) =>
        this.logger.error('Utility scheduling failed.', error),
      );
    };
    tick();
    this.reminderTimer = globalThis.setInterval(
      tick,
      REMINDER_POLL_INTERVAL_MS,
    );
    this.reminderTimer.unref();
  }
  async stop(): Promise<void> {
    if (this.reminderTimer) globalThis.clearInterval(this.reminderTimer);
    this.reminderTimer = null;
    await this.tickPromise;
    await Promise.allSettled(this.interactionChains.values());
  }

  async handleButton(interaction: Interaction): Promise<boolean> {
    if (
      !interaction.isButton() ||
      !interaction.inCachedGuild() ||
      ![POLL_PREFIX, EVENT_RSVP_PREFIX, LFG_PREFIX].some((prefix) =>
        interaction.customId.startsWith(prefix),
      )
    )
      return false;
    await interaction.deferUpdate();
    const key = interaction.message.id;
    const chain = (this.interactionChains.get(key) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        try {
          const isPoll = interaction.customId.startsWith(POLL_PREFIX);
          const isEvent = interaction.customId.startsWith(EVENT_RSVP_PREFIX);
          const prefix = isPoll
            ? POLL_PREFIX
            : isEvent
              ? EVENT_RSVP_PREFIX
              : LFG_PREFIX;
          const [id, action] = interaction.customId
            .slice(prefix.length)
            .split(':');
          const record = isPoll
            ? this.store.getPoll(id)
            : isEvent
              ? this.store.getEvent(id)
              : this.store.getLfg(id);
          if (
            !record ||
            record.guildId !== interaction.guildId ||
            record.channelId !== interaction.channelId ||
            ('messageId' in record &&
              record.messageId &&
              record.messageId !== interaction.message.id)
          ) {
            throw new UserFacingError(
              'That post is no longer available in this channel.',
            );
          }
          const denied = restrictionError(
            this.store.getGuildSettings(interaction.guildId),
            isPoll ? 'poll' : isEvent ? 'event' : 'lfg',
            interaction.channelId,
            [...interaction.member.roles.cache.keys()],
            interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild),
          );
          if (denied) throw new UserFacingError(denied);
          if (isPoll) {
            const updated = await this.store.votePoll(
              id,
              interaction.user.id,
              Number(action),
            );
            if (!updated)
              throw new UserFacingError('That poll option is unavailable.');
            await interaction.editReply(buildPollPayload(updated));
          } else if (isEvent) {
            const event = await this.store.toggleEventRsvp(
              id,
              interaction.user.id,
            );
            if (!event)
              throw new UserFacingError(
                'This event has been cancelled or already started.',
              );
            await interaction.editReply(buildEventPayload(event));
          } else {
            if (action !== 'join' && action !== 'leave' && action !== 'close')
              throw new UserFacingError('That LFG action is unavailable.');
            const lfg = await this.store.updateLfgParticipant(
              id,
              interaction.user.id,
              action,
            );
            if (!lfg)
              throw new UserFacingError(
                'This LFG post has expired or been closed.',
              );
            await interaction.editReply(buildLfgPayload(lfg));
            if (lfg.closed) await this.store.markLfgExpiryRendered(id);
          }
        } catch (error) {
          if (!(error instanceof UserFacingError))
            this.logger.error('Utility button failed.', error);
          await interaction.followUp({
            content:
              error instanceof UserFacingError
                ? error.message
                : 'Could not update this post. Please try again.',
            ephemeral: true,
          });
        }
      });
    this.interactionChains.set(key, chain);
    try {
      await chain;
    } finally {
      if (this.interactionChains.get(key) === chain)
        this.interactionChains.delete(key);
    }
    return true;
  }

  /** A single in-flight tick prevents slow sends from overlapping the next timer. */
  async tick(client: Client, now = new Date()): Promise<void> {
    if (this.tickPromise) return this.tickPromise;
    const promise = this.processScheduled(client, now);
    this.tickPromise = promise;
    try {
      await promise;
    } finally {
      this.tickPromise = null;
    }
  }

  private async processScheduled(client: Client, now: Date): Promise<void> {
    for (const reminder of this.store.getDueReminders(now)) {
      // Recheck ownership/state after earlier awaits so cancellation takes effect.
      const current = this.store.getReminder(reminder.id);
      if (current) await this.sendReminder(client, current, now);
    }
    for (const event of this.store.getDueEvents(now)) {
      try {
        const channel = await client.channels.fetch(event.channelId);
        const current = this.store.getEvent(event.id);
        if (
          !current ||
          current.cancelled ||
          current.startsAt !== event.startsAt
        )
          continue;
        if (
          !channel?.isTextBased() ||
          !('guildId' in channel) ||
          channel.guildId !== event.guildId ||
          !('send' in channel)
        )
          throw new Error('Event channel unavailable.');
        const userIds = current.attendees.filter(
          (id) => !(current.remindedUserIds ?? []).includes(id),
        );
        // Keep mention lists and message lengths within Discord limits.
        for (let index = 0; index < userIds.length; index += 40) {
          const latest = this.store.getEvent(current.id);
          if (
            !latest ||
            latest.cancelled ||
            latest.startsAt !== current.startsAt
          )
            break;
          const chunk = userIds
            .slice(index, index + 40)
            .filter(
              (id) =>
                latest.attendees.includes(id) &&
                !(latest.remindedUserIds ?? []).includes(id),
            );
          if (!chunk.length) continue;
          await channel.send({
            content: `${chunk.map((id) => `<@${id}>`).join(' ')} **${current.title}** starts ${formatTimestamp(current.startsAt, 'R')}.`,
            allowedMentions: { parse: [], users: chunk },
          });
          await this.store.markEventReminded(
            current.id,
            chunk,
            current.startsAt,
          );
        }
      } catch (error) {
        this.logger.warn(
          'Failed to deliver event reminder; will retry.',
          error,
        );
        await this.store.retryEventReminder(event.id, now);
      }
    }
    for (const lfg of this.store.getExpiredLfgs(now)) {
      if (
        await refreshUtilityMessage(
          client,
          lfg,
          buildLfgPayload(lfg),
          this.logger,
        )
      )
        await this.store.markLfgExpiryRendered(lfg.id);
    }
  }

  private async sendReminder(
    client: Client,
    reminder: SavedReminder,
    now: Date,
  ): Promise<void> {
    try {
      const channel = await client.channels.fetch(reminder.channelId);
      if (!this.store.getReminder(reminder.id)) return;
      if (
        !channel?.isTextBased() ||
        !('guildId' in channel) ||
        channel.guildId !== reminder.guildId ||
        !('send' in channel)
      )
        throw new Error('Reminder channel unavailable.');
      await channel.send({
        content: `<@${reminder.userId}> reminder: ${reminder.message}`,
        allowedMentions: { parse: [], users: [reminder.userId] },
      });
      await this.store.removeReminder(reminder.id);
    } catch (error) {
      this.logger.warn('Failed to deliver a reminder; will retry.', error);
      await this.store.retryReminder(reminder.id, now);
    }
  }
}

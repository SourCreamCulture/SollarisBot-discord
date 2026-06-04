import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Client,
  type GuildTextBasedChannel,
  type Interaction,
} from 'discord.js';

import type {
  SavedEvent,
  SavedPoll,
  SavedReminder,
  UtilityStore,
} from './utilityStore';
import type { Logger } from './logger';

const POLL_PREFIX = 'poll-vote:';
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

  return { embeds: [embed], components: [row] };
};

export const buildEventPayload = (event: SavedEvent) => {
  const attendeeText =
    event.attendees.length > 0
      ? event.attendees.map((userId) => `<@${userId}>`).join(', ')
      : 'No RSVPs yet.';
  const embed = new EmbedBuilder()
    .setColor(0x53d769)
    .setTitle(event.title)
    .setDescription(
      [
        `Starts ${formatTimestamp(event.startsAt)} (${formatTimestamp(event.startsAt, 'R')})`,
      ].join('\n'),
    )
    .addFields({
      name: `RSVPs (${event.attendees.length})`,
      value: attendeeText.slice(0, 1024),
    })
    .setFooter({ text: `Created by ${event.createdById}` })
    .setTimestamp(new Date(event.createdAt));
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${EVENT_RSVP_PREFIX}${event.id}`)
      .setLabel('RSVP')
      .setStyle(ButtonStyle.Success),
  );

  return { embeds: [embed], components: [row] };
};

export class UtilityInteractionManager {
  private reminderTimer: ReturnType<typeof globalThis.setInterval> | null =
    null;

  constructor(
    private readonly store: UtilityStore,
    private readonly logger: Logger,
  ) {}

  startReminderLoop(client: Client): void {
    if (this.reminderTimer) {
      return;
    }

    const tick = () => {
      void this.sendDueReminders(client);
    };

    tick();
    this.reminderTimer = globalThis.setInterval(
      tick,
      REMINDER_POLL_INTERVAL_MS,
    );
    this.reminderTimer.unref();
  }

  async handleButton(interaction: Interaction): Promise<boolean> {
    if (
      !interaction.isButton() ||
      !interaction.inCachedGuild() ||
      (!interaction.customId.startsWith(POLL_PREFIX) &&
        !interaction.customId.startsWith(EVENT_RSVP_PREFIX))
    ) {
      return false;
    }

    if (interaction.customId.startsWith(POLL_PREFIX)) {
      const [pollId, rawIndex] = interaction.customId
        .slice(POLL_PREFIX.length)
        .split(':');
      const optionIndex = Number.parseInt(rawIndex ?? '', 10);
      const poll = await this.store.votePoll(
        pollId,
        interaction.user.id,
        optionIndex,
      );

      if (!poll) {
        await interaction.reply({
          content: 'That poll is no longer available.',
          ephemeral: true,
        });
        return true;
      }

      await interaction.update(buildPollPayload(poll));
      return true;
    }

    const eventId = interaction.customId.slice(EVENT_RSVP_PREFIX.length);
    const event = await this.store.toggleEventRsvp(
      eventId,
      interaction.user.id,
    );

    if (!event) {
      await interaction.reply({
        content: 'That event is no longer available.',
        ephemeral: true,
      });
      return true;
    }

    await interaction.update(buildEventPayload(event));
    return true;
  }

  private async sendDueReminders(client: Client): Promise<void> {
    const due = this.store.getDueReminders(new Date());

    for (const reminder of due) {
      await this.sendReminder(client, reminder);
    }
  }

  private async sendReminder(
    client: Client,
    reminder: SavedReminder,
  ): Promise<void> {
    const removed = await this.store.removeReminder(reminder.id);

    if (!removed) {
      return;
    }

    try {
      const channel = await client.channels.fetch(reminder.channelId);

      if (!channel?.isTextBased()) {
        return;
      }

      await (channel as GuildTextBasedChannel).send({
        content: `<@${reminder.userId}> reminder: ${reminder.message}`,
      });
    } catch (error) {
      this.logger.warn('Failed to deliver a reminder.', error);
    }
  }
}

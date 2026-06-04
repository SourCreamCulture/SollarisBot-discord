import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';

import type { CommandModule } from '../types/bot';
import { buildEventPayload } from '../utils/utilityInteractions';

const parseEventTime = (input: string): Date | null => {
  const parsed = new Date(input.trim());
  return Number.isFinite(parsed.getTime()) && parsed.getTime() > Date.now()
    ? parsed
    : null;
};

export const eventCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('event')
    .setDescription('Create and view lightweight game-night events.')
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('create')
        .setDescription('Create an event with RSVP button.')
        .addStringOption((option) =>
          option
            .setName('title')
            .setDescription('Event title')
            .setRequired(true)
            .setMaxLength(120),
        )
        .addStringOption((option) =>
          option
            .setName('starts')
            .setDescription('Start time, like 2026-06-05 20:00')
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('list').setDescription('List upcoming events.'),
    ),
  execute: async (context) => {
    const subcommand = context.interaction.options.getSubcommand(true);

    if (subcommand === 'list') {
      const events = context.utilityStore
        .listEvents(context.interaction.guildId)
        .filter((event) => new Date(event.startsAt).getTime() > Date.now())
        .slice(0, 10);
      const embed = new EmbedBuilder()
        .setColor(0x4f9eed)
        .setTitle('Upcoming Events')
        .setDescription(
          events.length > 0
            ? events
                .map(
                  (event) =>
                    `**${event.title}** - <t:${Math.floor(
                      new Date(event.startsAt).getTime() / 1000,
                    )}:f> (${event.attendees.length} RSVP)`,
                )
                .join('\n')
            : 'No upcoming events.',
        )
        .setTimestamp();

      await context.interaction.reply({ embeds: [embed] });
      return;
    }

    const startsAt = parseEventTime(
      context.interaction.options.getString('starts', true),
    );

    if (!startsAt) {
      await context.replyError(
        'Use an exact future date/time, like `2026-06-05 20:00`.',
      );
      return;
    }

    const event = await context.utilityStore.addEvent({
      guildId: context.interaction.guildId,
      channelId: context.interaction.channelId,
      title: context.interaction.options.getString('title', true),
      startsAt: startsAt.toISOString(),
      createdById: context.interaction.user.id,
    });
    const reply = await context.interaction.reply({
      ...buildEventPayload(event),
      fetchReply: true,
    });

    await context.utilityStore.setEventMessage(event.id, reply.id);
  },
};

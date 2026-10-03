import {
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type SlashCommandSubcommandBuilder,
} from 'discord.js';
import type { CommandModule } from '../types/bot';
import {
  buildEventPayload,
  refreshUtilityMessage,
} from '../utils/utilityInteractions';
import { isTimezone, parseScheduledTime } from '../utils/scheduling';

const eventOptions = (sub: SlashCommandSubcommandBuilder, required: boolean) =>
  sub
    .addStringOption((o) =>
      o
        .setName('title')
        .setDescription('Event title')
        .setRequired(required)
        .setMaxLength(120),
    )
    .addStringOption((o) =>
      o
        .setName('starts')
        .setDescription('YYYY-MM-DD HH:mm in timezone, or ISO date with offset')
        .setRequired(required),
    )
    .addStringOption((o) =>
      o
        .setName('timezone')
        .setDescription('IANA timezone; defaults to server timezone'),
    )
    .addIntegerOption((o) =>
      o
        .setName('limit')
        .setDescription('Maximum RSVPs; 0 means unlimited')
        .setMinValue(0)
        .setMaxValue(100),
    )
    .addIntegerOption((o) =>
      o
        .setName('reminder-minutes')
        .setDescription(
          'Notify attendees this many minutes before start; 0 disables',
        )
        .setMinValue(0)
        .setMaxValue(10080),
    );

export const eventCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('event')
    .setDescription('Plan game nights with RSVP controls and reminders.')
    .setDMPermission(false)
    .addSubcommand((s) =>
      eventOptions(
        s.setName('create').setDescription('Create a game night.'),
        true,
      ),
    )
    .addSubcommand((s) =>
      s.setName('list').setDescription('List upcoming events and their IDs.'),
    )
    .addSubcommand((s) =>
      eventOptions(
        s
          .setName('edit')
          .setDescription('Edit your event, or any event as a server manager.')
          .addStringOption((o) =>
            o
              .setName('id')
              .setDescription('Event ID from /event list or event footer')
              .setRequired(true)
              .setAutocomplete(true),
          ),
        false,
      ),
    )
    .addSubcommand((s) =>
      s
        .setName('cancel')
        .setDescription('Cancel your event, or any event as a server manager.')
        .addStringOption((o) =>
          o
            .setName('id')
            .setDescription('Event ID')
            .setRequired(true)
            .setAutocomplete(true),
        ),
    ),
  autocomplete: async (context) => {
    const input = context.interaction.options.getFocused().toLowerCase();
    const canManage = context.interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild,
    );
    await context.interaction.respond(
      context.utilityStore
        .listEvents(context.interaction.guildId)
        .filter(
          (e) =>
            !e.cancelled &&
            (canManage || e.createdById === context.interaction.user.id) &&
            e.title.toLowerCase().includes(input),
        )
        .slice(0, 25)
        .map((e) => ({ name: e.title.slice(0, 100), value: e.id })),
    );
  },
  execute: async (context) => {
    const { interaction, utilityStore } = context;
    const sub = interaction.options.getSubcommand(true);
    if (sub === 'list') {
      const events = utilityStore
        .listEvents(interaction.guildId)
        .filter((e) => !e.cancelled && Date.parse(e.startsAt) > Date.now())
        .slice(0, 10);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x4f9eed)
            .setTitle('Upcoming Events')
            .setDescription(
              events.length
                ? events
                    .map(
                      (e) =>
                        `**${e.title}** · <t:${Math.floor(Date.parse(e.startsAt) / 1000)}:f> · ${e.attendees.length}${e.capacity ? `/${e.capacity}` : ''} RSVP\nID: \`${e.id}\``,
                    )
                    .join('\n\n')
                : 'No upcoming events.',
            ),
        ],
      });
      return;
    }
    const existing =
      sub === 'create'
        ? null
        : utilityStore.getEvent(interaction.options.getString('id', true));
    if (
      sub !== 'create' &&
      (!existing || existing.guildId !== interaction.guildId)
    ) {
      await context.replyError('That event was not found in this server.');
      return;
    }
    if (
      existing &&
      existing.createdById !== interaction.user.id &&
      !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)
    ) {
      await context.replyError(
        'Only the event creator or a server manager can edit or cancel it.',
      );
      return;
    }
    if (existing?.cancelled) {
      await context.replyError('This event has already been cancelled.');
      return;
    }
    if (existing && Date.parse(existing.startsAt) <= Date.now()) {
      await context.replyError(
        'This event has already started. Create a new event instead.',
      );
      return;
    }
    await context.deferReply({ ephemeral: sub !== 'create' });
    if (sub === 'cancel' && existing) {
      const event = await utilityStore.updateEvent(existing.id, {
        cancelled: true,
      });
      const updated =
        event &&
        (await refreshUtilityMessage(
          interaction.client,
          event,
          buildEventPayload(event),
          context.logger,
        ));
      await context.replySuccess(
        `Event cancelled. Attendee reminders have stopped.${updated ? '' : ' The original message could not be updated; its RSVP button will reject new signups.'}`,
      );
      return;
    }
    const settings = utilityStore.getGuildSettings(interaction.guildId);
    const timezone =
      interaction.options.getString('timezone') ?? settings.timezone;
    const startsInput = interaction.options.getString('starts');
    if (!isTimezone(timezone)) {
      await context.replyError(
        'Use a valid IANA timezone, such as America/New_York or UTC.',
      );
      return;
    }
    const starts = startsInput
      ? parseScheduledTime(startsInput, timezone)
      : existing
        ? new Date(existing.startsAt)
        : null;
    if (!starts) {
      await context.replyError(
        `Use a future time like \`2026-12-05 20:00\` (${timezone}), or \`2026-12-05T20:00:00-05:00\`. For ambiguous or skipped daylight-saving times, provide an explicit offset.`,
      );
      return;
    }
    const limit = interaction.options.getInteger('limit');
    const reminder = interaction.options.getInteger('reminder-minutes');
    const title = interaction.options.getString('title');
    if (existing) {
      if (!startsInput && limit === null && reminder === null && !title) {
        await context.replyError(
          'Provide a title, start time, limit, or reminder lead time to change.',
        );
        return;
      }
      const event = await utilityStore.updateEvent(existing.id, {
        title: title ?? existing.title,
        startsAt: starts.toISOString(),
        capacity: limit === null ? existing.capacity : limit || null,
        reminderMinutes: reminder ?? existing.reminderMinutes,
      });
      const updated =
        event &&
        (await refreshUtilityMessage(
          interaction.client,
          event,
          buildEventPayload(event),
          context.logger,
        ));
      await context.replySuccess(
        `Event updated.${updated ? '' : ' The original message could not be updated; /event list shows the saved details.'}`,
      );
      return;
    }
    const event = await utilityStore.addEvent({
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      title: title!,
      startsAt: starts.toISOString(),
      createdById: interaction.user.id,
      capacity: limit || null,
      reminderMinutes: reminder ?? settings.eventReminderMinutes,
    });
    const message = await interaction.editReply(buildEventPayload(event));
    await utilityStore.setEventMessage(event.id, message.id);
  },
};

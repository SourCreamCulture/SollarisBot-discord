import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';

import type { CommandModule } from '../types/bot';

const DURATION_PATTERN =
  /(\d+)\s*(d|day|days|h|hr|hour|hours|m|min|minute|minutes|s|sec|second|seconds)/gi;

const parseReminderTime = (input: string): Date | null => {
  const trimmed = input.trim();

  if (/^tomorrow$/i.test(trimmed)) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    return tomorrow;
  }

  const absolute = new Date(trimmed);

  if (Number.isFinite(absolute.getTime()) && absolute.getTime() > Date.now()) {
    return absolute;
  }

  let totalMs = 0;
  for (const match of trimmed.matchAll(DURATION_PATTERN)) {
    const amount = Number.parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    if (unit.startsWith('d')) {
      totalMs += amount * 86_400_000;
    } else if (unit.startsWith('h')) {
      totalMs += amount * 3_600_000;
    } else if (unit.startsWith('m')) {
      totalMs += amount * 60_000;
    } else {
      totalMs += amount * 1000;
    }
  }

  if (totalMs <= 0) {
    return null;
  }

  return new Date(Date.now() + totalMs);
};

export const remindCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('remind')
    .setDescription('Create and view personal reminders.')
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('me')
        .setDescription('Remind yourself later.')
        .addStringOption((option) =>
          option
            .setName('when')
            .setDescription('When, like 45m, 2h30m, tomorrow, or an ISO date')
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('message')
            .setDescription('What to remind you about')
            .setRequired(true)
            .setMaxLength(500),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('list').setDescription('List your pending reminders.'),
    ),
  execute: async (context) => {
    const subcommand = context.interaction.options.getSubcommand(true);

    if (subcommand === 'list') {
      const reminders = context.utilityStore
        .listReminders(context.interaction.user.id)
        .slice(0, 10);
      const embed = new EmbedBuilder()
        .setColor(0x4f9eed)
        .setTitle('Your Reminders')
        .setDescription(
          reminders.length > 0
            ? reminders
                .map(
                  (reminder) =>
                    `<t:${Math.floor(
                      new Date(reminder.remindAt).getTime() / 1000,
                    )}:R> - ${reminder.message}`,
                )
                .join('\n')
            : 'You do not have any pending reminders.',
        )
        .setTimestamp();

      await context.interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    const remindAt = parseReminderTime(
      context.interaction.options.getString('when', true),
    );

    if (!remindAt) {
      await context.replyError(
        'Use a time like `45m`, `2h30m`, or an exact future date.',
      );
      return;
    }

    const reminder = await context.utilityStore.addReminder({
      guildId: context.interaction.guildId,
      channelId: context.interaction.channelId,
      userId: context.interaction.user.id,
      message: context.interaction.options.getString('message', true),
      remindAt: remindAt.toISOString(),
    });

    await context.replySuccess(
      `Reminder set for <t:${Math.floor(
        new Date(reminder.remindAt).getTime() / 1000,
      )}:f> (<t:${Math.floor(new Date(reminder.remindAt).getTime() / 1000)}:R>).`,
    );
  },
};

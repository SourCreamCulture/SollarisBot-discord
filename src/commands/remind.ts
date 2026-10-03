import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';

import type { CommandModule } from '../types/bot';

import { parseReminderTime } from '../utils/scheduling';

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
    )
    .addSubcommand((s) =>
      s
        .setName('cancel')
        .setDescription('Cancel one of your reminders in this server.')
        .addStringOption((o) =>
          o
            .setName('id')
            .setDescription('Reminder ID from /remind list')
            .setRequired(true)
            .setAutocomplete(true),
        ),
    ),
  autocomplete: async (context) => {
    const input = context.interaction.options.getFocused().toLowerCase();
    await context.interaction.respond(
      context.utilityStore
        .listReminders(context.interaction.user.id, context.interaction.guildId)
        .filter((r) => r.message.toLowerCase().includes(input))
        .slice(0, 25)
        .map((r) => ({ name: r.message.slice(0, 100), value: r.id })),
    );
  },
  execute: async (context) => {
    const subcommand = context.interaction.options.getSubcommand(true);

    if (subcommand === 'cancel') {
      const reminder = context.utilityStore.getReminder(
        context.interaction.options.getString('id', true),
      );
      if (
        !reminder ||
        reminder.userId !== context.interaction.user.id ||
        reminder.guildId !== context.interaction.guildId
      ) {
        await context.replyError(
          'That reminder was not found among your reminders in this server.',
        );
        return;
      }
      await context.deferReply({ ephemeral: true });
      await context.utilityStore.removeReminder(reminder.id);
      await context.replySuccess('Reminder cancelled.');
      return;
    }

    if (subcommand === 'list') {
      const reminders = context.utilityStore
        .listReminders(context.interaction.user.id, context.interaction.guildId)
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
                    )}:R> - ${reminder.message.slice(0, 180)}\nID: \`${reminder.id}\`${reminder.attempts ? ` · delivery retries: ${reminder.attempts}` : ''}`,
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
      context.utilityStore.getGuildSettings(context.interaction.guildId)
        .timezone,
    );

    if (!remindAt) {
      await context.replyError(
        'Use a time like `45m`, `2h30m`, or an exact future date.',
      );
      return;
    }

    await context.deferReply({ ephemeral: true });
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

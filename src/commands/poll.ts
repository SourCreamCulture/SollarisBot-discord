import { SlashCommandBuilder } from 'discord.js';

import type { CommandModule } from '../types/bot';
import { buildPollPayload } from '../utils/utilityInteractions';

const parseOptions = (input: string): string[] =>
  input
    .split('|')
    .map((option) => option.trim())
    .filter(Boolean)
    .slice(0, 5);

export const pollCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Create a simple button poll.')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('question')
        .setDescription('The poll question')
        .setRequired(true)
        .setMaxLength(200),
    )
    .addStringOption((option) =>
      option
        .setName('options')
        .setDescription('Separate 2-5 options with | characters')
        .setRequired(true)
        .setMaxLength(400),
    ),
  execute: async (context) => {
    const question = context.interaction.options.getString('question', true);
    const options = parseOptions(
      context.interaction.options.getString('options', true),
    );

    if (options.length < 2) {
      await context.replyError(
        'Polls need at least two options separated by `|`.',
      );
      return;
    }

    const poll = await context.utilityStore.addPoll({
      guildId: context.interaction.guildId,
      channelId: context.interaction.channelId,
      question,
      options,
      createdById: context.interaction.user.id,
    });

    await context.interaction.reply(buildPollPayload(poll));
  },
};

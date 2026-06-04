import { SlashCommandBuilder } from 'discord.js';

import type { CommandModule } from '../types/bot';

const dicePattern = /^(\d*)d(\d+)(?:\s*([+-])\s*(\d+))?$/i;

const rollDice = (input: string): string | null => {
  const match = dicePattern.exec(input.trim());

  if (!match) {
    return null;
  }

  const count = Math.min(100, Number.parseInt(match[1] || '1', 10));
  const sides = Number.parseInt(match[2], 10);
  const sign = match[3];
  const modifier = match[4] ? Number.parseInt(match[4], 10) : 0;

  if (!Number.isFinite(count) || !Number.isFinite(sides) || sides < 2) {
    return null;
  }

  const rolls = Array.from(
    { length: count },
    () => Math.floor(Math.random() * sides) + 1,
  );
  const modifierValue = sign === '-' ? -modifier : modifier;
  const total = rolls.reduce((sum, roll) => sum + roll, 0) + modifierValue;
  const modifierText = modifier ? ` ${sign} ${modifier}` : '';

  return `Rolled \`${count}d${sides}${modifierText}\`: **${total}** (${rolls.join(', ')})`;
};

const pickChoices = (input: string, count: number): string[] => {
  const choices = input
    .split('|')
    .map((choice) => choice.trim())
    .filter(Boolean);
  const shuffled = [...choices].sort(() => Math.random() - 0.5);

  return shuffled.slice(0, Math.min(count, shuffled.length));
};

export const rollCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Roll dice or pick from a list.')
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('dice')
        .setDescription('Roll dice, like 2d20+5.')
        .addStringOption((option) =>
          option
            .setName('dice')
            .setDescription('Dice expression')
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('pick')
        .setDescription('Pick one or more options separated by |.')
        .addStringOption((option) =>
          option
            .setName('choices')
            .setDescription('Choices separated by |')
            .setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName('count')
            .setDescription('How many choices to pick')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(20),
        ),
    ),
  execute: async (context) => {
    const subcommand = context.interaction.options.getSubcommand(true);

    if (subcommand === 'dice') {
      const result = rollDice(
        context.interaction.options.getString('dice', true),
      );

      if (!result) {
        await context.replyError('Use dice like `d20`, `2d6`, or `4d6+2`.');
        return;
      }

      await context.replySuccess(result);
      return;
    }

    const choices = pickChoices(
      context.interaction.options.getString('choices', true),
      context.interaction.options.getInteger('count') ?? 1,
    );

    if (choices.length === 0) {
      await context.replyError('Give me at least one choice.');
      return;
    }

    await context.replySuccess(`Picked: **${choices.join('**, **')}**`);
  },
};

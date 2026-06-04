import { EmbedBuilder, SlashCommandBuilder, userMention } from 'discord.js';

import { createStatusEmbed } from '../utils/embeds';
import type { CommandModule } from '../types/bot';
import { APEX_PLATFORM_CHOICES, getPlatformLabel } from '../apex/platform';
import {
  ApexError,
  type ApexAppPlatform,
  type ApexLegendCard,
  type ApexOverviewCard,
} from '../apex/types';

const buildStatsEmbed = (
  card: ApexOverviewCard | ApexLegendCard,
): EmbedBuilder =>
  new EmbedBuilder()
    .setColor(card.color)
    .setTitle(card.title)
    .setURL(card.url)
    .setDescription(card.description)
    .setFooter({
      text: card.footer,
    })
    .setTimestamp()
    .setThumbnail(card.thumbnailUrl ?? null)
    .addFields(card.fields);

const buildErrorEmbed = (title: string, message: string): EmbedBuilder =>
  createStatusEmbed(title, message, 0xf44336);

const applyPlatformChoices = <
  T extends {
    addChoices(...choices: Array<{ name: string; value: string }>): T;
  },
>(
  option: T,
): T =>
  APEX_PLATFORM_CHOICES.reduce(
    (current, choice) =>
      current.addChoices({
        name: choice.name,
        value: choice.value,
      }),
    option,
  );

const formatLinkSuccess = (
  displayName: string,
  username: string,
  platform: ApexAppPlatform,
): string =>
  [
    `Linked **${displayName}** on **${getPlatformLabel(platform)}**.`,
    `Saved username: \`${username}\``,
  ].join('\n');

const handleApexError = async (
  context: Parameters<NonNullable<CommandModule['execute']>>[0],
  error: unknown,
): Promise<void> => {
  if (error instanceof ApexError) {
    const title =
      error.code === 'provider_error' || error.code === 'config'
        ? 'Apex Service Error'
        : 'Apex Lookup Error';

    await context.interaction.editReply({
      embeds: [buildErrorEmbed(title, error.message)],
    });
    return;
  }

  throw error;
};

export const apexCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('apex')
    .setDescription('Link an Apex account and look up Apex Legends stats.')
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('link')
        .setDescription('Link your Discord account to an Apex account.')
        .addStringOption((option) =>
          applyPlatformChoices(
            option
              .setName('platform')
              .setDescription('Select the Apex platform.')
              .setRequired(true),
          ),
        )
        .addStringOption((option) =>
          option
            .setName('username')
            .setDescription('Your Apex username on that platform.')
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName('uid')
            .setDescription('Optional Apex UID if username lookup fails.')
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('unlink')
        .setDescription('Remove your saved Apex account link.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('me')
        .setDescription('Show stats for your linked Apex account.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('member')
        .setDescription("Show stats for another member's linked Apex account.")
        .addUserOption((option) =>
          option
            .setName('user')
            .setDescription('The Discord member to look up.')
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('lookup')
        .setDescription('Look up Apex stats without linking an account.')
        .addStringOption((option) =>
          applyPlatformChoices(
            option
              .setName('platform')
              .setDescription('Select the Apex platform.')
              .setRequired(true),
          ),
        )
        .addStringOption((option) =>
          option
            .setName('username')
            .setDescription('The Apex username to look up.')
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName('uid')
            .setDescription('Optional Apex UID if username lookup fails.')
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('legend')
        .setDescription('Show legend-specific stats.')
        .addStringOption((option) =>
          option
            .setName('legend')
            .setDescription('Legend name, like Wraith or Pathfinder.')
            .setRequired(true),
        )
        .addUserOption((option) =>
          option
            .setName('user')
            .setDescription(
              'A linked Discord member to use instead of your own linked account.',
            )
            .setRequired(false),
        )
        .addStringOption((option) =>
          applyPlatformChoices(
            option
              .setName('platform')
              .setDescription('Optional manual platform lookup override.')
              .setRequired(false),
          ),
        )
        .addStringOption((option) =>
          option
            .setName('username')
            .setDescription('Optional manual Apex username override.')
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName('uid')
            .setDescription('Optional manual Apex UID override.')
            .setRequired(false),
        ),
    ),
  execute: async (context) => {
    const subcommand = context.interaction.options.getSubcommand(true);

    try {
      switch (subcommand) {
        case 'link': {
          await context.deferReply({ ephemeral: true });
          const platform = context.interaction.options.getString(
            'platform',
            true,
          );
          const username =
            context.interaction.options.getString('username') ?? undefined;
          const uid = context.interaction.options.getString('uid') ?? undefined;
          const linked = await context.apex.linkAccount({
            discordUserId: context.interaction.user.id,
            appPlatform: platform as ApexAppPlatform,
            username,
            uid,
          });

          await context.interaction.editReply({
            embeds: [
              createStatusEmbed(
                'Apex Account Linked',
                formatLinkSuccess(
                  linked.displayName,
                  linked.username,
                  linked.appPlatform,
                ),
                0x53d769,
              ),
            ],
          });
          return;
        }
        case 'unlink': {
          await context.deferReply({ ephemeral: true });
          const removed = await context.apex.unlinkAccount(
            context.interaction.user.id,
          );
          const description = removed
            ? 'Your saved Apex account link has been removed.'
            : 'You did not have a linked Apex account to remove.';

          await context.interaction.editReply({
            embeds: [
              createStatusEmbed(
                'Apex Account Unlinked',
                description,
                removed ? 0x53d769 : 0x4f9eed,
              ),
            ],
          });
          return;
        }
        case 'me': {
          await context.deferReply();
          const card = await context.apex.getOverviewForSelf(
            context.interaction.user.id,
          );
          await context.interaction.editReply({
            embeds: [buildStatsEmbed(card)],
          });
          return;
        }
        case 'member': {
          await context.deferReply();
          const user = context.interaction.options.getUser('user', true);
          const card = await context.apex.getOverviewForMember(user.id);
          await context.interaction.editReply({
            embeds: [
              buildStatsEmbed({
                ...card,
                description: `Overview for ${userMention(user.id)}'s linked Apex account.`,
              }),
            ],
          });
          return;
        }
        case 'lookup': {
          await context.deferReply();
          const platform = context.interaction.options.getString(
            'platform',
            true,
          );
          const username =
            context.interaction.options.getString('username') ?? undefined;
          const uid = context.interaction.options.getString('uid') ?? undefined;
          const card = await context.apex.getOverviewForLookup({
            appPlatform: platform as ApexAppPlatform,
            username,
            uid,
          });

          await context.interaction.editReply({
            embeds: [buildStatsEmbed(card)],
          });
          return;
        }
        case 'legend': {
          await context.deferReply();
          const legend = context.interaction.options.getString('legend', true);
          const user = context.interaction.options.getUser('user');
          const platform = context.interaction.options.getString('platform');
          const username = context.interaction.options.getString('username');
          const uid = context.interaction.options.getString('uid');
          const card = await context.apex.getLegendForRequest({
            requesterId: context.interaction.user.id,
            legend,
            memberId: user?.id,
            appPlatform: platform ? (platform as ApexAppPlatform) : undefined,
            username: username ?? undefined,
            uid: uid ?? undefined,
          });

          await context.interaction.editReply({
            embeds: [buildStatsEmbed(card)],
          });
          return;
        }
        default:
          throw new ApexError(
            'invalid_target',
            `Unsupported Apex subcommand: ${subcommand}`,
          );
      }
    } catch (error) {
      await handleApexError(context, error);
    }
  },
};

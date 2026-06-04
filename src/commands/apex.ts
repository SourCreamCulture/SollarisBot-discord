import { EmbedBuilder, SlashCommandBuilder, userMention } from 'discord.js';

import { createStatusEmbed } from '../utils/embeds';
import type { CommandModule } from '../types/bot';
import { APEX_PLATFORM_CHOICES, getPlatformLabel } from '../apex/platform';
import {
  ApexError,
  type ApexAppPlatform,
  type ApexCompareCard,
  type ApexLegendCard,
  type ApexMapRotation,
  type ApexOverviewCard,
  type ApexRankCard,
  type ApexSquadCard,
  type ApexWatchCard,
} from '../apex/types';

const buildStatsEmbed = (
  card:
    | ApexOverviewCard
    | ApexLegendCard
    | ApexRankCard
    | ApexCompareCard
    | ApexSquadCard
    | ApexWatchCard,
): EmbedBuilder => {
  const embed = new EmbedBuilder()
    .setColor(card.color)
    .setTitle(card.title)
    .setDescription(card.description)
    .setFooter({
      text: card.footer,
    })
    .setTimestamp()
    .addFields(card.fields);

  if ('url' in card) {
    embed.setURL(card.url);
  }

  if ('thumbnailUrl' in card) {
    embed.setThumbnail(card.thumbnailUrl ?? null);
  }

  return embed;
};

const buildErrorEmbed = (title: string, message: string): EmbedBuilder =>
  createStatusEmbed(title, message, 0xf44336);

const buildMapEmbed = (rotation: ApexMapRotation): EmbedBuilder => {
  const remaining =
    typeof rotation.current.remainingSeconds === 'number'
      ? `${Math.round(rotation.current.remainingSeconds / 60)} minute(s)`
      : 'Unknown';
  const next = rotation.next
    ? `Next: **${rotation.next.map}**${
        rotation.next.startsAt
          ? ` at <t:${Math.floor(new Date(rotation.next.startsAt).getTime() / 1000)}:t>`
          : ''
      }`
    : 'Next map unavailable.';

  return new EmbedBuilder()
    .setColor(0xda292a)
    .setTitle('Apex Map Rotation')
    .setDescription(
      [
        `Current: **${rotation.current.map}**`,
        `Mode: **${rotation.current.mode ?? 'Battle Royale'}**`,
        `Remaining: **${remaining}**`,
        next,
      ].join('\n'),
    )
    .setFooter({ text: rotation.source })
    .setTimestamp();
};

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
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('map')
        .setDescription('Show the current Apex map rotation.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('rank')
        .setDescription('Show focused ranked stats.')
        .addUserOption((option) =>
          option
            .setName('user')
            .setDescription('Optional linked member to look up')
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('compare')
        .setDescription('Compare your linked account with another member.')
        .addUserOption((option) =>
          option
            .setName('user')
            .setDescription('Linked member to compare against')
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('squad')
        .setDescription('Show a compact linked squad card.')
        .addUserOption((option) =>
          option
            .setName('member1')
            .setDescription('First linked member')
            .setRequired(true),
        )
        .addUserOption((option) =>
          option
            .setName('member2')
            .setDescription('Second linked member')
            .setRequired(false),
        )
        .addUserOption((option) =>
          option
            .setName('member3')
            .setDescription('Third linked member')
            .setRequired(false),
        )
        .addUserOption((option) =>
          option
            .setName('member4')
            .setDescription('Fourth linked member')
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('watch')
        .setDescription('Save or compare an Apex stat snapshot for yourself.'),
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
        case 'map': {
          await context.deferReply();
          const rotation = await context.apex.getMapRotation();
          await context.interaction.editReply({
            embeds: [buildMapEmbed(rotation)],
          });
          return;
        }
        case 'rank': {
          await context.deferReply();
          const user = context.interaction.options.getUser('user');
          const card = await context.apex.getRankForRequest({
            requesterId: context.interaction.user.id,
            memberId: user?.id,
          });
          await context.interaction.editReply({
            embeds: [buildStatsEmbed(card)],
          });
          return;
        }
        case 'compare': {
          await context.deferReply();
          const user = context.interaction.options.getUser('user', true);
          const card = await context.apex.compareLinkedAccounts({
            requesterId: context.interaction.user.id,
            memberId: user.id,
          });
          await context.interaction.editReply({
            embeds: [buildStatsEmbed(card)],
          });
          return;
        }
        case 'squad': {
          await context.deferReply();
          const users = ['member1', 'member2', 'member3', 'member4']
            .map((name) => context.interaction.options.getUser(name))
            .filter((user): user is NonNullable<typeof user> => Boolean(user));
          const card = await context.apex.getSquadCard(
            users.map((user) => user.id),
          );
          await context.interaction.editReply({
            embeds: [buildStatsEmbed(card)],
          });
          return;
        }
        case 'watch': {
          await context.deferReply({ ephemeral: true });
          const card = await context.apex.watchAccount(
            context.interaction.user.id,
          );
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

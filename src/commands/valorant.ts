import { postLfg } from '../utils/lfg';
import { EmbedBuilder, SlashCommandBuilder, userMention } from 'discord.js';

import {
  VALORANT_MODE_CHOICES,
  VALORANT_PLATFORM_CHOICES,
  VALORANT_REGION_CHOICES,
  assertValorantPlatform,
  assertValorantRegion,
  getValorantPlatformLabel,
  getValorantRegionLabel,
} from '../valorant/platform';
import {
  ValorantError,
  type ValorantAgent,
  type ValorantBaseCard,
  type ValorantMap,
  type ValorantWeapon,
} from '../valorant/types';
import type { CommandModule } from '../types/bot';
import { createStatusEmbed } from '../utils/embeds';

const VALORANT_COLOR = 0xff4655;

const truncate = (value: string, maxLength: number): string =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;

const buildCardEmbed = (card: ValorantBaseCard): EmbedBuilder => {
  const embed = new EmbedBuilder()
    .setColor(card.color)
    .setTitle(card.title)
    .setDescription(card.description)
    .setFooter({ text: card.footer })
    .setTimestamp()
    .addFields(card.fields);

  if (card.thumbnailUrl) {
    embed.setThumbnail(card.thumbnailUrl);
  }

  if (card.imageUrl) {
    embed.setImage(card.imageUrl);
  }

  return embed;
};

const buildAgentEmbed = (agent: ValorantAgent): EmbedBuilder => {
  const embed = new EmbedBuilder()
    .setColor(VALORANT_COLOR)
    .setTitle(agent.displayName)
    .setDescription(agent.description ?? 'No agent description available.')
    .setThumbnail(agent.displayIcon ?? null)
    .setImage(agent.fullPortrait ?? null)
    .setFooter({ text: 'Valorant-API game data' })
    .setTimestamp();

  embed.addFields({
    name: 'Role',
    value: agent.role?.displayName ?? 'Unknown',
    inline: true,
  });

  if (agent.abilities.length > 0) {
    embed.addFields({
      name: 'Abilities',
      value: agent.abilities
        .map((ability) =>
          ability.description
            ? `**${ability.displayName}**: ${truncate(ability.description, 150)}`
            : `**${ability.displayName}**`,
        )
        .join('\n'),
      inline: false,
    });
  }

  return embed;
};

const buildMapEmbed = (map: ValorantMap): EmbedBuilder =>
  new EmbedBuilder()
    .setColor(VALORANT_COLOR)
    .setTitle(map.displayName)
    .setDescription(
      [
        map.tacticalDescription
          ? `Layout: **${map.tacticalDescription}**`
          : undefined,
        map.narrativeDescription
          ? truncate(map.narrativeDescription, 400)
          : undefined,
        map.coordinates ? `Coordinates: **${map.coordinates}**` : undefined,
        `Known callouts: **${map.calloutCount}**`,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .setThumbnail(map.displayIcon ?? null)
    .setImage(map.splash ?? null)
    .addFields(
      map.callouts.length > 0
        ? {
            name: 'Callouts',
            value: truncate(
              map.callouts
                .slice(0, 18)
                .map((callout) =>
                  callout.superRegionName
                    ? `${callout.superRegionName}: ${callout.regionName}`
                    : callout.regionName,
                )
                .join('\n'),
              1024,
            ),
            inline: false,
          }
        : {
            name: 'Callouts',
            value: 'No callout data available.',
            inline: false,
          },
    )
    .setFooter({ text: 'Valorant-API game data' })
    .setTimestamp();

const formatDamageRanges = (weapon: ValorantWeapon): string => {
  if (weapon.damageRanges.length === 0) {
    return 'No damage range data available.';
  }

  return weapon.damageRanges
    .slice(0, 3)
    .map((range) => {
      const distance =
        range.rangeStartMeters === undefined ||
        range.rangeEndMeters === undefined
          ? 'Range'
          : `${range.rangeStartMeters}-${range.rangeEndMeters}m`;

      return `${distance}: H ${range.headDamage ?? '?'} / B ${
        range.bodyDamage ?? '?'
      } / L ${range.legDamage ?? '?'}`;
    })
    .join('\n');
};

const buildWeaponEmbed = (weapon: ValorantWeapon): EmbedBuilder =>
  new EmbedBuilder()
    .setColor(VALORANT_COLOR)
    .setTitle(weapon.displayName)
    .setDescription(weapon.shopCategory ?? weapon.category ?? 'Valorant weapon')
    .setThumbnail(weapon.displayIcon ?? null)
    .addFields(
      {
        name: 'Cost',
        value: weapon.cost === undefined ? 'Unknown' : `${weapon.cost} credits`,
        inline: true,
      },
      {
        name: 'Fire Rate',
        value:
          weapon.fireRate === undefined ? 'Unknown' : String(weapon.fireRate),
        inline: true,
      },
      {
        name: 'Magazine',
        value:
          weapon.magazineSize === undefined
            ? 'Unknown'
            : String(weapon.magazineSize),
        inline: true,
      },
      {
        name: 'Reload',
        value:
          weapon.reloadTimeSeconds === undefined
            ? 'Unknown'
            : `${weapon.reloadTimeSeconds}s`,
        inline: true,
      },
      {
        name: 'Penetration',
        value: weapon.wallPenetration ?? 'Unknown',
        inline: true,
      },
      {
        name: 'Damage',
        value: formatDamageRanges(weapon),
        inline: false,
      },
    )
    .setFooter({ text: 'Valorant-API game data' })
    .setTimestamp();

const buildRandomCompEmbed = (agents: ValorantAgent[]): EmbedBuilder =>
  new EmbedBuilder()
    .setColor(VALORANT_COLOR)
    .setTitle('Valorant Random Comp')
    .setDescription(
      agents
        .map(
          (agent, index) =>
            `${index + 1}. **${agent.displayName}** - ${
              agent.role?.displayName ?? 'Flex'
            }`,
        )
        .join('\n'),
    )
    .setThumbnail(agents[0]?.displayIcon ?? null)
    .setFooter({ text: 'Valorant-API game data' })
    .setTimestamp();

const buildErrorEmbed = (title: string, message: string): EmbedBuilder =>
  createStatusEmbed(title, message, 0xf44336);

const applyRegionChoices = <
  T extends {
    addChoices(...choices: Array<{ name: string; value: string }>): T;
  },
>(
  option: T,
): T =>
  VALORANT_REGION_CHOICES.reduce(
    (current, choice) =>
      current.addChoices({ name: choice.name, value: choice.value }),
    option,
  );

const applyPlatformChoices = <
  T extends {
    addChoices(...choices: Array<{ name: string; value: string }>): T;
  },
>(
  option: T,
): T =>
  VALORANT_PLATFORM_CHOICES.reduce(
    (current, choice) =>
      current.addChoices({ name: choice.name, value: choice.value }),
    option,
  );

const applyModeChoices = <
  T extends {
    addChoices(...choices: Array<{ name: string; value: string }>): T;
  },
>(
  option: T,
): T =>
  VALORANT_MODE_CHOICES.reduce(
    (current, choice) =>
      current.addChoices({ name: choice.name, value: choice.value }),
    option,
  );

const applySiteChoices = <
  T extends {
    addChoices(...choices: Array<{ name: string; value: string }>): T;
  },
>(
  option: T,
): T =>
  option.addChoices(
    { name: 'A Site', value: 'A' },
    { name: 'B Site', value: 'B' },
    { name: 'C Site', value: 'C' },
    { name: 'Mid', value: 'Mid' },
  );

const applyRankSortChoices = <
  T extends {
    addChoices(...choices: Array<{ name: string; value: string }>): T;
  },
>(
  option: T,
): T =>
  option.addChoices(
    { name: 'Rank', value: 'rank' },
    { name: 'KDA', value: 'kda' },
    { name: 'Winrate', value: 'winrate' },
    { name: 'Headshot %', value: 'hs' },
  );

const addManualTargetOptions = <
  T extends {
    addUserOption(
      callback: Parameters<SlashCommandBuilder['addUserOption']>[0],
    ): T;
    addStringOption(
      callback: Parameters<SlashCommandBuilder['addStringOption']>[0],
    ): T;
  },
>(
  subcommand: T,
): T =>
  subcommand
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('Optional linked Discord member to look up.')
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName('name')
        .setDescription('Optional Riot ID name for a manual lookup.')
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName('tag')
        .setDescription('Optional Riot ID tag for a manual lookup.')
        .setRequired(false),
    )
    .addStringOption((option) =>
      applyRegionChoices(
        option
          .setName('region')
          .setDescription('Region for a manual lookup.')
          .setRequired(false),
      ),
    )
    .addStringOption((option) =>
      applyPlatformChoices(
        option
          .setName('platform')
          .setDescription('Platform for a manual lookup.')
          .setRequired(false),
      ),
    );

const readTargetRequest = (
  context: Parameters<NonNullable<CommandModule['execute']>>[0],
) => {
  const user = context.interaction.options.getUser('user');
  const name = context.interaction.options.getString('name') ?? undefined;
  const tag = context.interaction.options.getString('tag') ?? undefined;
  const region = context.interaction.options.getString('region');
  const platform = context.interaction.options.getString('platform');

  if (user && (name || tag || region || platform)) {
    throw new ValorantError(
      'invalid_target',
      'Use either a Discord member or manual Riot ID options, not both.',
    );
  }

  return {
    requesterId: context.interaction.user.id,
    memberId: user?.id,
    name,
    tag,
    region: region ? assertValorantRegion(region) : undefined,
    platform: platform ? assertValorantPlatform(platform) : undefined,
  };
};

const handleValorantError = async (
  context: Parameters<NonNullable<CommandModule['execute']>>[0],
  error: unknown,
): Promise<void> => {
  if (error instanceof ValorantError) {
    const title =
      error.code === 'provider_error' || error.code === 'config'
        ? 'Valorant Service Error'
        : 'Valorant Lookup Error';

    await context.interaction.editReply({
      embeds: [buildErrorEmbed(title, error.message)],
    });
    return;
  }

  throw error;
};

export const valorantCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('valorant')
    .setDescription('Look up Valorant game data, ranks, and recent matches.')
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('agent')
        .setDescription('Look up a Valorant agent.')
        .addStringOption((option) =>
          option
            .setName('name')
            .setDescription('Agent name, like Jett or Sova.')
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('map')
        .setDescription('Look up a Valorant map.')
        .addStringOption((option) =>
          option
            .setName('name')
            .setDescription('Map name, like Ascent or Bind.')
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('weapon')
        .setDescription('Look up Valorant weapon stats.')
        .addStringOption((option) =>
          option
            .setName('name')
            .setDescription('Weapon name, like Vandal or Ghost.')
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('random-agent')
        .setDescription('Pick a random Valorant agent.')
        .addUserOption((option) =>
          option
            .setName('user')
            .setDescription('Optional member to pick an agent for.')
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName('role')
            .setDescription('Optional role filter.')
            .setRequired(false)
            .addChoices(
              { name: 'Controller', value: 'Controller' },
              { name: 'Duelist', value: 'Duelist' },
              { name: 'Initiator', value: 'Initiator' },
              { name: 'Sentinel', value: 'Sentinel' },
            ),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('random-comp')
        .setDescription('Generate a random 5-stack Valorant team comp.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('strat')
        .setDescription('Generate a Valorant strat for a map or site.')
        .addStringOption((option) =>
          option
            .setName('map')
            .setDescription('Optional map to build the strat around.')
            .setRequired(false)
            .setAutocomplete(true),
        )
        .addStringOption((option) =>
          applySiteChoices(
            option
              .setName('site')
              .setDescription('Optional site or lane.')
              .setRequired(false),
          ),
        )
        .addStringOption((option) =>
          option
            .setName('tone')
            .setDescription('Serious or silly.')
            .setRequired(false)
            .addChoices(
              { name: 'Serious', value: 'serious' },
              { name: 'Silly', value: 'silly' },
            ),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('link')
        .setDescription('Link your Discord account to a Valorant Riot ID.')
        .addStringOption((option) =>
          option
            .setName('name')
            .setDescription('Your Riot ID name before the #.')
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('tag')
            .setDescription('Your Riot ID tag after the #.')
            .setRequired(true),
        )
        .addStringOption((option) =>
          applyRegionChoices(
            option
              .setName('region')
              .setDescription('Your Valorant region.')
              .setRequired(true),
          ),
        )
        .addStringOption((option) =>
          applyPlatformChoices(
            option
              .setName('platform')
              .setDescription('Your Valorant platform.')
              .setRequired(true),
          ),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('unlink')
        .setDescription('Remove your saved Valorant account link.'),
    )
    .addSubcommand((subcommand) =>
      addManualTargetOptions(
        subcommand
          .setName('me')
          .setDescription('Show a Valorant account overview.'),
      ),
    )
    .addSubcommand((subcommand) =>
      addManualTargetOptions(
        subcommand
          .setName('profile')
          .setDescription(
            'Show a Valorant profile by linked account or Riot ID.',
          ),
      ),
    )
    .addSubcommand((subcommand) =>
      addManualTargetOptions(
        subcommand
          .setName('rank')
          .setDescription('Show current Valorant rank and RR.'),
      ),
    )
    .addSubcommand((subcommand) =>
      addManualTargetOptions(
        subcommand
          .setName('matches')
          .setDescription('Show recent Valorant matches.')
          .addIntegerOption((option) =>
            option
              .setName('size')
              .setDescription('Number of matches to show.')
              .setRequired(false)
              .setMinValue(1)
              .setMaxValue(10),
          )
          .addStringOption((option) =>
            applyModeChoices(
              option
                .setName('mode')
                .setDescription('Optional queue filter.')
                .setRequired(false),
            ),
          ),
      ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('match')
        .setDescription('Show a Valorant match scoreboard by match ID.')
        .addStringOption((option) =>
          option
            .setName('match-id')
            .setDescription('The Valorant match UUID.')
            .setRequired(true),
        )
        .addStringOption((option) =>
          applyRegionChoices(
            option
              .setName('region')
              .setDescription('Region the match was played in.')
              .setRequired(true),
          ),
        ),
    )
    .addSubcommand((subcommand) =>
      addManualTargetOptions(
        subcommand
          .setName('stats')
          .setDescription('Show recent Valorant KDA, HS%, winrate, and agents.')
          .addIntegerOption((option) =>
            option
              .setName('size')
              .setDescription('Number of recent matches to aggregate.')
              .setRequired(false)
              .setMinValue(1)
              .setMaxValue(10),
          )
          .addStringOption((option) =>
            applyModeChoices(
              option
                .setName('mode')
                .setDescription('Optional queue filter.')
                .setRequired(false),
            ),
          ),
      ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('leaderboard')
        .setDescription(
          'Show a server leaderboard for linked Valorant accounts.',
        )
        .addStringOption((option) =>
          applyRankSortChoices(
            option
              .setName('sort')
              .setDescription('Metric to rank linked accounts by.')
              .setRequired(false),
          ),
        )
        .addIntegerOption((option) =>
          option
            .setName('size')
            .setDescription('Recent matches to use for stat-based rankings.')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(10),
        )
        .addStringOption((option) =>
          applyModeChoices(
            option
              .setName('mode')
              .setDescription('Optional queue filter for stat-based rankings.')
              .setRequired(false),
          ),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('lfg')
        .setDescription('Create a Valorant looking-for-group post.')
        .addStringOption((option) =>
          option
            .setName('role')
            .setDescription('Preferred role.')
            .setRequired(true)
            .addChoices(
              { name: 'Controller', value: 'Controller' },
              { name: 'Duelist', value: 'Duelist' },
              { name: 'Initiator', value: 'Initiator' },
              { name: 'Sentinel', value: 'Sentinel' },
              { name: 'Flex', value: 'Flex' },
            ),
        )
        .addIntegerOption((option) =>
          option
            .setName('needed')
            .setDescription('How many players you need.')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(4),
        )
        .addStringOption((option) =>
          applyRegionChoices(
            option
              .setName('region')
              .setDescription('Region if you have not linked an account.')
              .setRequired(false),
          ),
        )
        .addStringOption((option) =>
          option
            .setName('note')
            .setDescription('Short queue/time note.')
            .setRequired(false)
            .setMaxLength(120),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('team-balance')
        .setDescription('Split linked Valorant players into balanced teams.')
        .addUserOption((option) =>
          option
            .setName('player1')
            .setDescription('First linked player.')
            .setRequired(true),
        )
        .addUserOption((option) =>
          option
            .setName('player2')
            .setDescription('Second linked player.')
            .setRequired(true),
        )
        .addUserOption((option) =>
          option
            .setName('player3')
            .setDescription('Third linked player.')
            .setRequired(false),
        )
        .addUserOption((option) =>
          option
            .setName('player4')
            .setDescription('Fourth linked player.')
            .setRequired(false),
        )
        .addUserOption((option) =>
          option
            .setName('player5')
            .setDescription('Fifth linked player.')
            .setRequired(false),
        )
        .addUserOption((option) =>
          option
            .setName('player6')
            .setDescription('Sixth linked player.')
            .setRequired(false),
        )
        .addUserOption((option) =>
          option
            .setName('player7')
            .setDescription('Seventh linked player.')
            .setRequired(false),
        )
        .addUserOption((option) =>
          option
            .setName('player8')
            .setDescription('Eighth linked player.')
            .setRequired(false),
        )
        .addUserOption((option) =>
          option
            .setName('player9')
            .setDescription('Ninth linked player.')
            .setRequired(false),
        )
        .addUserOption((option) =>
          option
            .setName('player10')
            .setDescription('Tenth linked player.')
            .setRequired(false),
        ),
    ),
  execute: async (context) => {
    const subcommand = context.interaction.options.getSubcommand(true);

    try {
      switch (subcommand) {
        case 'agent': {
          await context.deferReply();
          const name = context.interaction.options.getString('name', true);
          const agent = await context.valorant.findAgent(name);
          await context.interaction.editReply({
            embeds: [buildAgentEmbed(agent)],
          });
          return;
        }
        case 'map': {
          await context.deferReply();
          const name = context.interaction.options.getString('name', true);
          const map = await context.valorant.findMap(name);
          await context.interaction.editReply({
            embeds: [buildMapEmbed(map)],
          });
          return;
        }
        case 'weapon': {
          await context.deferReply();
          const name = context.interaction.options.getString('name', true);
          const weapon = await context.valorant.findWeapon(name);
          await context.interaction.editReply({
            embeds: [buildWeaponEmbed(weapon)],
          });
          return;
        }
        case 'random-agent': {
          await context.deferReply();
          const role =
            context.interaction.options.getString('role') ?? undefined;
          const user = context.interaction.options.getUser('user');
          const agent = await context.valorant.getRandomAgent(role);
          const embed = buildAgentEmbed(agent);

          if (user) {
            embed.setDescription(
              `Picked for ${userMention(user.id)}.\n\n${
                agent.description ?? 'No agent description available.'
              }`,
            );
          }

          await context.interaction.editReply({
            embeds: [embed],
          });
          return;
        }
        case 'random-comp': {
          await context.deferReply();
          const comp = await context.valorant.getRandomComp();
          await context.interaction.editReply({
            embeds: [buildRandomCompEmbed(comp)],
          });
          return;
        }
        case 'strat': {
          await context.deferReply();
          const map = context.interaction.options.getString('map') ?? undefined;
          const site =
            context.interaction.options.getString('site') ?? undefined;
          const tone =
            (context.interaction.options.getString('tone') as
              | 'serious'
              | 'silly'
              | null) ?? undefined;
          const card = await context.valorant.getStrat({ map, site, tone });

          await context.interaction.editReply({
            embeds: [buildCardEmbed(card)],
          });
          return;
        }
        case 'link': {
          await context.deferReply({ ephemeral: true });
          const name = context.interaction.options.getString('name', true);
          const tag = context.interaction.options.getString('tag', true);
          const region = assertValorantRegion(
            context.interaction.options.getString('region', true),
          );
          const platform = assertValorantPlatform(
            context.interaction.options.getString('platform', true),
          );
          const linked = await context.valorant.linkAccount({
            discordUserId: context.interaction.user.id,
            name,
            tag,
            region,
            platform,
          });

          await context.interaction.editReply({
            embeds: [
              createStatusEmbed(
                'Valorant Account Linked',
                [
                  `Linked **${linked.name}#${linked.tag}**.`,
                  `Region: **${getValorantRegionLabel(linked.region)}**`,
                  `Platform: **${getValorantPlatformLabel(linked.platform)}**`,
                ].join('\n'),
                0x53d769,
              ),
            ],
          });
          return;
        }
        case 'unlink': {
          await context.deferReply({ ephemeral: true });
          const removed = await context.valorant.unlinkAccount(
            context.interaction.user.id,
          );
          await context.interaction.editReply({
            embeds: [
              createStatusEmbed(
                'Valorant Account Unlinked',
                removed
                  ? 'Your saved Valorant account link has been removed.'
                  : 'You did not have a linked Valorant account to remove.',
                removed ? 0x53d769 : 0x4f9eed,
              ),
            ],
          });
          return;
        }
        case 'me': {
          await context.deferReply();
          const target = readTargetRequest(context);
          const card = await context.valorant.getAccountCard(target);
          await context.interaction.editReply({
            embeds: [buildCardEmbed(card)],
          });
          return;
        }
        case 'profile': {
          await context.deferReply();
          const target = readTargetRequest(context);
          const card = await context.valorant.getAccountCard(target);
          await context.interaction.editReply({
            embeds: [buildCardEmbed(card)],
          });
          return;
        }
        case 'rank': {
          await context.deferReply();
          const target = readTargetRequest(context);
          const card = await context.valorant.getRankCard(target);
          await context.interaction.editReply({
            embeds: [buildCardEmbed(card)],
          });
          return;
        }
        case 'matches': {
          await context.deferReply();
          const target = readTargetRequest(context);
          const size = context.interaction.options.getInteger('size') ?? 5;
          const mode =
            context.interaction.options.getString('mode') ?? undefined;
          const card = await context.valorant.getMatchesCard({
            ...target,
            size,
            mode,
          });
          const user = context.interaction.options.getUser('user');
          await context.interaction.editReply({
            embeds: [
              buildCardEmbed(
                user
                  ? {
                      ...card,
                      description: `${card.description}\nTarget: ${userMention(
                        user.id,
                      )}`,
                    }
                  : card,
              ),
            ],
          });
          return;
        }
        case 'match': {
          await context.deferReply();
          const matchId = context.interaction.options.getString(
            'match-id',
            true,
          );
          const region = assertValorantRegion(
            context.interaction.options.getString('region', true),
          );
          const card = await context.valorant.getMatchCard({ region, matchId });

          await context.interaction.editReply({
            embeds: [buildCardEmbed(card)],
          });
          return;
        }
        case 'stats': {
          await context.deferReply();
          const target = readTargetRequest(context);
          const size = context.interaction.options.getInteger('size') ?? 10;
          const mode =
            context.interaction.options.getString('mode') ?? undefined;
          const card = await context.valorant.getStatsCard({
            ...target,
            size,
            mode,
          });

          await context.interaction.editReply({
            embeds: [buildCardEmbed(card)],
          });
          return;
        }
        case 'leaderboard': {
          await context.deferReply();
          const sortBy =
            (context.interaction.options.getString('sort') as
              | 'rank'
              | 'kda'
              | 'winrate'
              | 'hs'
              | null) ?? undefined;
          const size = context.interaction.options.getInteger('size') ?? 10;
          const mode =
            context.interaction.options.getString('mode') ?? undefined;
          const card = await context.valorant.getLeaderboardCard({
            sortBy,
            size,
            mode,
          });

          await context.interaction.editReply({
            embeds: [buildCardEmbed(card)],
          });
          return;
        }
        case 'lfg': {
          await context.deferReply();
          const role = context.interaction.options.getString('role', true);
          const needed = context.interaction.options.getInteger('needed') ?? 1;
          const note = context.interaction.options.getString('note');
          const linked = context.valorant.getLinkedAccount(
            context.interaction.user.id,
          );
          const fallbackRegion =
            context.interaction.options.getString('region');
          const region =
            linked?.region ??
            (fallbackRegion ? assertValorantRegion(fallbackRegion) : undefined);
          let rank = 'Rank unavailable';

          if (linked) {
            try {
              const rankCard = await context.valorant.getRankCard({
                requesterId: context.interaction.user.id,
              });
              rank =
                rankCard.fields.find((field) => field.name === 'Current')
                  ?.value ?? rank;
            } catch {
              rank = 'Rank unavailable';
            }
          }

          if (!region) {
            throw new ValorantError(
              'invalid_target',
              'Use `/valorant link` first, or provide a region for this LFG post.',
            );
          }

          await postLfg(
            context,
            'valorant',
            needed,
            [
              `Role: **${role}**`,
              `Region: **${getValorantRegionLabel(region)}**`,
              `Rank: **${rank}**`,
              note ? `Note: ${note}` : undefined,
            ]
              .filter(Boolean)
              .join('\n'),
          );
          return;
        }
        case 'team-balance': {
          await context.deferReply();
          const players = Array.from({ length: 10 }, (_, index) =>
            context.interaction.options.getUser(`player${index + 1}`),
          )
            .filter((user): user is NonNullable<typeof user> => Boolean(user))
            .map((user) => ({
              discordUserId: user.id,
              displayName: user.globalName ?? user.username,
            }));
          const card = await context.valorant.getTeamBalanceCard({ players });

          await context.interaction.editReply({
            embeds: [buildCardEmbed(card)],
          });
          return;
        }
        default:
          throw new ValorantError(
            'invalid_target',
            `Unsupported Valorant subcommand: ${subcommand}`,
          );
      }
    } catch (error) {
      await handleValorantError(context, error);
    }
  },
  autocomplete: async (context) => {
    const focused = context.interaction.options.getFocused(true);
    const subcommand = context.interaction.options.getSubcommand(true);
    let choices: string[] = [];

    if (focused.name === 'name') {
      if (subcommand === 'agent') {
        choices = await context.valorant.listAgentChoices(focused.value);
      } else if (subcommand === 'map') {
        choices = await context.valorant.listMapChoices(focused.value);
      } else if (subcommand === 'weapon') {
        choices = await context.valorant.listWeaponChoices(focused.value);
      }
    } else if (focused.name === 'map') {
      choices = await context.valorant.listMapChoices(focused.value);
    }

    await context.interaction.respond(
      choices.map((choice) => ({ name: choice, value: choice })),
    );
  },
};

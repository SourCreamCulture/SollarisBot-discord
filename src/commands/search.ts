import {
  ActionRowBuilder,
  EmbedBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';

import type { CommandModule } from '../types/bot';
import { requireVoiceChannel } from '../music/guards';

const SEARCH_LIMIT = 5;

const truncate = (value: string, maxLength: number): string =>
  value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;

export const searchCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search YouTube and choose a result to play.')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('What to search for on YouTube')
        .setRequired(true),
    ),
  execute: async (context) => {
    await context.deferReply();

    const voiceChannel = await requireVoiceChannel(context);

    if (!voiceChannel) {
      return;
    }

    const query = context.interaction.options.getString('query', true);
    const result = await context.player.search(query, {
      requestedBy: context.interaction.user,
      searchEngine: context.config.music.youtubeSearchEngine,
    });

    if (result.isEmpty()) {
      await context.editReply({
        title: 'No Results',
        description: `I could not find anything for \`${query}\`.`,
      });
      return;
    }

    const tracks = result.tracks.slice(0, SEARCH_LIMIT);
    const embed = new EmbedBuilder()
      .setColor(0x4f9eed)
      .setTitle('Choose A Track')
      .setDescription(
        tracks
          .map(
            (track, index) =>
              `**${index + 1}.** [${track.title}](${track.url}) • \`${track.duration}\``,
          )
          .join('\n'),
      )
      .setFooter({ text: 'This menu is only meant for the person who searched.' })
      .setTimestamp();

    const select = new StringSelectMenuBuilder()
      .setCustomId(`music-search:${context.interaction.user.id}`)
      .setPlaceholder('Pick a track to queue')
      .addOptions(
        tracks.map((track, index) => ({
          label: truncate(`${index + 1}. ${track.title}`, 100),
          description: truncate(`${track.author} • ${track.duration}`, 100),
          value: track.url,
        })),
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      select,
    );

    await context.interaction.editReply({
      embeds: [embed],
      components: [row],
    });
  },
};

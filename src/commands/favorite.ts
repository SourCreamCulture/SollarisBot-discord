import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';

import type { CommandModule } from '../types/bot';
import { createSavedTrack, type SavedTrack } from '../music/library';
import { queueSavedTracks } from '../music/libraryPlayback';
import { formatTrackLine } from '../music/service';
import { requireControllableSession } from '../music/guards';

const FAVORITES_PAGE_SIZE = 10;

const formatSavedTrackLine = (track: SavedTrack, index: number): string =>
  `**${index}.** [${track.title}](${track.url}) • \`${track.duration}\``;

export const favoriteCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('favorite')
    .setDescription('Save and play your personal favorite tracks.')
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add-current')
        .setDescription('Save the currently playing track to your favorites.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add')
        .setDescription('Search YouTube and save the first result to your favorites.')
        .addStringOption((option) =>
          option
            .setName('query')
            .setDescription('A YouTube search term or URL')
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('list').setDescription('List your saved favorites.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('play')
        .setDescription('Play one of your saved favorites.')
        .addStringOption((option) =>
          option
            .setName('favorite')
            .setDescription('Pick a saved favorite')
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('remove')
        .setDescription('Remove one of your saved favorites.')
        .addStringOption((option) =>
          option
            .setName('favorite')
            .setDescription('Pick a saved favorite')
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('clear').setDescription('Clear all of your favorites.'),
    ),
  execute: async (context) => {
    const subcommand = context.interaction.options.getSubcommand(true);
    const userId = context.interaction.user.id;

    switch (subcommand) {
      case 'add-current': {
        const session = await requireControllableSession(context);

        if (!session) {
          return;
        }

        const track = session.queue.currentTrack;

        if (!track) {
          await context.replyError('There is no current track to save.');
          return;
        }

        await context.musicLibrary.addFavorite(userId, createSavedTrack(track, userId));
        await context.replySuccess(`Saved ${formatTrackLine(track)} to your favorites.`);
        return;
      }
      case 'add': {
        await context.deferReply({ ephemeral: true });
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

        const track = result.tracks[0];
        await context.musicLibrary.addFavorite(userId, createSavedTrack(track, userId));
        await context.editReply({
          title: 'Favorite Saved',
          description: `Saved [${track.title}](${track.url}) • \`${track.duration}\` to your favorites.`,
        });
        return;
      }
      case 'list': {
        const favorites = context.musicLibrary.listFavorites(userId);

        if (favorites.length === 0) {
          await context.replyError('You do not have any saved favorites yet.');
          return;
        }

        const embed = new EmbedBuilder()
          .setColor(0x4f9eed)
          .setTitle('Your Favorites')
          .setDescription(
            favorites
              .slice(0, FAVORITES_PAGE_SIZE)
              .map((track, index) => formatSavedTrackLine(track, index + 1))
              .join('\n'),
          )
          .setFooter({
            text:
              favorites.length > FAVORITES_PAGE_SIZE
                ? `Showing ${FAVORITES_PAGE_SIZE} of ${favorites.length} favorites.`
                : `${favorites.length} saved favorite(s).`,
          })
          .setTimestamp();

        await context.interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }
      case 'play': {
        await context.deferReply();
        const position = Number(
          context.interaction.options.getString('favorite', true),
        );
        const favorite = context.musicLibrary.listFavorites(userId)[position - 1];

        if (!favorite) {
          await context.editReply({
            title: 'Favorite Not Found',
            description: `You do not have a favorite at position **${position}**.`,
          });
          return;
        }

        const result = await queueSavedTracks(context, [favorite]);

        if (!result) {
          return;
        }

        await context.editReply({
          title: result.startedPlayback ? 'Now Playing' : 'Favorite Queued',
          description: `[${favorite.title}](${favorite.url}) • \`${favorite.duration}\``,
        });
        return;
      }
      case 'remove': {
        const position = Number(
          context.interaction.options.getString('favorite', true),
        );
        const removed = await context.musicLibrary.removeFavorite(userId, position);

        if (!removed) {
          await context.replyError(
            `You do not have a favorite at position **${position}**.`,
          );
          return;
        }

        await context.replySuccess(`Removed **${removed.title}** from your favorites.`);
        return;
      }
      case 'clear': {
        const count = await context.musicLibrary.clearFavorites(userId);

        if (count === 0) {
          await context.replyError('You do not have any favorites to clear.');
          return;
        }

        await context.replySuccess(`Cleared **${count}** favorite(s).`);
      }
    }
  },
  autocomplete: async (context) => {
    const subcommand = context.interaction.options.getSubcommand();

    if (subcommand !== 'play' && subcommand !== 'remove') {
      await context.interaction.respond([]);
      return;
    }

    const focused = context.interaction.options.getFocused(true);
    const favorites = context.musicLibrary.listFavorites(context.interaction.user.id);
    const filtered = favorites
      .map((track, index) => ({
        name: `${index + 1}. ${track.title}`.slice(0, 100),
        value: String(index + 1),
      }))
      .filter((choice) =>
        choice.name.toLowerCase().includes(String(focused.value).toLowerCase()),
      )
      .slice(0, 25);

    await context.interaction.respond(filtered);
  },
};

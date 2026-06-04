import {
  EmbedBuilder,
  SlashCommandBuilder,
  type SlashCommandStringOption,
} from 'discord.js';

import type { CommandModule } from '../types/bot';
import { requireControllableSession } from '../music/guards';
import {
  createSavedTrack,
  type PlaylistImportMode,
  type SavedPlaylist,
  type SavedTrack,
} from '../music/library';
import { queueSavedTracks } from '../music/libraryPlayback';
import { requireDjOrOpenControl } from '../music/permissions';
import { resolveSpotifyPlaylistToYoutubeTracks } from '../music/spotify';
import { formatTrackLine } from '../music/service';

const FAVORITES_PAGE_SIZE = 10;
const PLAYLIST_TRACK_PAGE_SIZE = 12;
const PLAYLIST_IMPORT_MODE_CHOICES = [
  { name: 'Append', value: 'append' },
  { name: 'Skip Duplicates', value: 'skip-duplicates' },
  { name: 'Replace', value: 'replace' },
] as const;

const formatSavedTrackLine = (track: SavedTrack, index: number): string =>
  `**${index}.** [${track.title}](${track.url}) • \`${track.duration}\``;

const formatPlaylistSummary = (playlist: SavedPlaylist): string =>
  `**${playlist.name}** • \`${playlist.tracks.length}\` track(s)`;

const applyPlaylistNameOption = <
  T extends {
    setName(name: string): T;
    setDescription(description: string): T;
    setRequired(required: boolean): T;
    setAutocomplete(enabled: boolean): T;
  },
>(
  option: T,
): T =>
  option
    .setName('name')
    .setDescription('Playlist name')
    .setRequired(true)
    .setAutocomplete(true);

const applyPlaylistImportNameOption = (
  option: SlashCommandStringOption,
): SlashCommandStringOption =>
  option
    .setName('name')
    .setDescription('Existing playlist name or a new one to create')
    .setRequired(true)
    .setMaxLength(50);

const applyImportModeOption = (
  option: SlashCommandStringOption,
): SlashCommandStringOption =>
  option
    .setName('mode')
    .setDescription('How to handle tracks already in the playlist')
    .setRequired(false)
    .addChoices(
      ...PLAYLIST_IMPORT_MODE_CHOICES.map((choice) => ({ ...choice })),
    );

const describeImportMode = (mode: PlaylistImportMode): string => {
  switch (mode) {
    case 'skip-duplicates':
      return 'Skip duplicates';
    case 'replace':
      return 'Replace existing tracks';
    case 'append':
    default:
      return 'Append';
  }
};

const getPlaylistImportMode = (
  context: Parameters<CommandModule['execute']>[0],
): PlaylistImportMode =>
  (context.interaction.options.getString(
    'mode',
  ) as PlaylistImportMode | null) ?? 'append';

const buildImportDescription = (options: {
  importedPlaylistName: string;
  importedCount: number;
  targetPlaylistName: string;
  mode: PlaylistImportMode;
  skippedDuplicates: number;
  skippedOverflow: number;
  createdPlaylist: boolean;
}): string => {
  const lines = [];

  if (options.createdPlaylist) {
    lines.push(`Created new playlist **${options.targetPlaylistName}**.`);
  }

  lines.push(
    `Imported **${options.importedCount}** track(s) from **${options.importedPlaylistName}** into **${options.targetPlaylistName}**.`,
    `Mode: **${describeImportMode(options.mode)}**`,
  );

  if (options.skippedDuplicates > 0) {
    lines.push(`Skipped **${options.skippedDuplicates}** duplicate track(s).`);
  }

  if (options.skippedOverflow > 0) {
    lines.push(
      `Skipped **${options.skippedOverflow}** track(s) because the playlist is full.`,
    );
  }

  return lines.join('\n');
};

const ensurePlaylistForImport = async (
  context: Parameters<CommandModule['execute']>[0],
  guildId: string,
  name: string,
  userId: string,
): Promise<{ playlist: SavedPlaylist; created: boolean }> => {
  const existingPlaylist = context.musicLibrary.getPlaylist(guildId, name);

  if (existingPlaylist) {
    return { playlist: existingPlaylist, created: false };
  }

  const playlist = await context.musicLibrary.createPlaylist(
    guildId,
    name,
    userId,
  );
  return { playlist, created: true };
};

const requirePlaylistEditor = async (
  context: Parameters<CommandModule['execute']>[0],
) => requireDjOrOpenControl(context, 'edit server playlists');

const handleFavorites = async (
  context: Parameters<CommandModule['execute']>[0],
  subcommand: string,
) => {
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

      await context.musicLibrary.addFavorite(
        userId,
        createSavedTrack(track, userId),
      );
      await context.replySuccess(
        `Saved ${formatTrackLine(track)} to your favorites.`,
      );
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
      await context.musicLibrary.addFavorite(
        userId,
        createSavedTrack(track, userId),
      );
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
      const removed = await context.musicLibrary.removeFavorite(
        userId,
        position,
      );

      if (!removed) {
        await context.replyError(
          `You do not have a favorite at position **${position}**.`,
        );
        return;
      }

      await context.replySuccess(
        `Removed **${removed.title}** from your favorites.`,
      );
      return;
    }
    case 'clear':
    default: {
      const count = await context.musicLibrary.clearFavorites(userId);

      if (count === 0) {
        await context.replyError('You do not have any favorites to clear.');
        return;
      }

      await context.replySuccess(`Cleared **${count}** favorite(s).`);
      return;
    }
  }
};

const handlePlaylists = async (
  context: Parameters<CommandModule['execute']>[0],
  subcommand: string,
) => {
  const guildId = context.interaction.guildId;
  const userId = context.interaction.user.id;

  switch (subcommand) {
    case 'create': {
      if (!(await requirePlaylistEditor(context))) {
        return;
      }

      const name = context.interaction.options.getString('name', true);
      const playlist = await context.musicLibrary.createPlaylist(
        guildId,
        name,
        userId,
      );

      await context.replySuccess(`Created playlist **${playlist.name}**.`);
      return;
    }
    case 'list': {
      const playlists = context.musicLibrary.listPlaylists(guildId);

      if (playlists.length === 0) {
        await context.replyError(
          'This server does not have any playlists yet.',
        );
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x4f9eed)
        .setTitle('Server Playlists')
        .setDescription(playlists.map(formatPlaylistSummary).join('\n'))
        .setTimestamp();

      await context.interaction.reply({ embeds: [embed] });
      return;
    }
    case 'show': {
      const name = context.interaction.options.getString('name', true);
      const playlist = context.musicLibrary.getPlaylist(guildId, name);

      if (!playlist) {
        await context.replyError(`Playlist **${name}** does not exist.`);
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x4f9eed)
        .setTitle(`Playlist: ${playlist.name}`)
        .setDescription(
          playlist.tracks.length === 0
            ? 'This playlist is empty.'
            : playlist.tracks
                .slice(0, PLAYLIST_TRACK_PAGE_SIZE)
                .map((track, index) => formatSavedTrackLine(track, index + 1))
                .join('\n'),
        )
        .setFooter({
          text:
            playlist.tracks.length > PLAYLIST_TRACK_PAGE_SIZE
              ? `Showing ${PLAYLIST_TRACK_PAGE_SIZE} of ${playlist.tracks.length} tracks.`
              : `${playlist.tracks.length} saved track(s).`,
        })
        .setTimestamp();

      await context.interaction.reply({ embeds: [embed] });
      return;
    }
    case 'play': {
      await context.deferReply();
      const name = context.interaction.options.getString('name', true);
      const playlist = context.musicLibrary.getPlaylist(guildId, name);

      if (!playlist) {
        await context.editReply({
          title: 'Playlist Not Found',
          description: `Playlist **${name}** does not exist.`,
        });
        return;
      }

      if (playlist.tracks.length === 0) {
        await context.editReply({
          title: 'Playlist Empty',
          description: `Playlist **${playlist.name}** does not have any tracks yet.`,
        });
        return;
      }

      const result = await queueSavedTracks(context, playlist.tracks);

      if (!result) {
        return;
      }

      await context.editReply({
        title: result.startedPlayback ? 'Playlist Started' : 'Playlist Queued',
        description: `Queued **${result.queuedCount}** track(s) from **${playlist.name}**.`,
      });
      return;
    }
    case 'add-current': {
      if (!(await requirePlaylistEditor(context))) {
        return;
      }

      const session = await requireControllableSession(context);

      if (!session) {
        return;
      }

      const track = session.queue.currentTrack;

      if (!track) {
        await context.replyError('There is no current track to add.');
        return;
      }

      const name = context.interaction.options.getString('name', true);
      const playlist = await context.musicLibrary.addPlaylistTrack(
        guildId,
        name,
        createSavedTrack(track, userId),
      );

      await context.replySuccess(
        `Added ${formatTrackLine(track)} to **${playlist.name}**.`,
      );
      return;
    }
    case 'add': {
      if (!(await requirePlaylistEditor(context))) {
        return;
      }

      await context.deferReply({ ephemeral: true });
      const name = context.interaction.options.getString('name', true);
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
      const playlist = await context.musicLibrary.addPlaylistTrack(
        guildId,
        name,
        createSavedTrack(track, userId),
      );

      await context.editReply({
        title: 'Playlist Updated',
        description: `Added [${track.title}](${track.url}) to **${playlist.name}**.`,
      });
      return;
    }
    case 'remove': {
      if (!(await requirePlaylistEditor(context))) {
        return;
      }

      const name = context.interaction.options.getString('name', true);
      const position = context.interaction.options.getInteger('position', true);
      const result = await context.musicLibrary.removePlaylistTrack(
        guildId,
        name,
        position,
      );

      if (!result) {
        await context.replyError(
          `Playlist **${name}** does not have a track at position **${position}**.`,
        );
        return;
      }

      await context.replySuccess(
        `Removed **${result.removed.title}** from **${result.playlist.name}**.`,
      );
      return;
    }
    case 'clear': {
      if (!(await requirePlaylistEditor(context))) {
        return;
      }

      const name = context.interaction.options.getString('name', true);
      const playlist = await context.musicLibrary.clearPlaylist(guildId, name);

      if (!playlist) {
        await context.replyError(`Playlist **${name}** does not exist.`);
        return;
      }

      await context.replySuccess(
        `Cleared all tracks from **${playlist.name}**.`,
      );
      return;
    }
    case 'import-queue': {
      if (!(await requirePlaylistEditor(context))) {
        return;
      }

      const session = await requireControllableSession(context);

      if (!session) {
        return;
      }

      const tracks = [
        ...(session.queue.currentTrack ? [session.queue.currentTrack] : []),
        ...session.queue.tracks.toArray(),
      ];

      if (tracks.length === 0) {
        await context.replyError(
          'There are no tracks in the current session to import.',
        );
        return;
      }

      const name = context.interaction.options.getString('name', true);
      const { playlist, created } = await ensurePlaylistForImport(
        context,
        guildId,
        name,
        userId,
      );

      const result = await context.musicLibrary.importPlaylistTracks(
        guildId,
        playlist.name,
        tracks.map((track) => createSavedTrack(track, userId)),
        'append',
      );

      await context.replySuccess(
        buildImportDescription({
          importedPlaylistName: 'the current queue',
          importedCount: result.addedCount,
          targetPlaylistName: result.playlist.name,
          mode: result.mode,
          skippedDuplicates: result.skippedDuplicates,
          skippedOverflow: result.skippedOverflow,
          createdPlaylist: created,
        }),
      );
      return;
    }
    case 'import-youtube':
    case 'import-spotify': {
      if (!(await requirePlaylistEditor(context))) {
        return;
      }

      await context.deferReply({ ephemeral: true });
      const name = context.interaction.options.getString('name', true);
      const url = context.interaction.options.getString('url', true);
      const mode = getPlaylistImportMode(context);
      const { playlist, created } = await ensurePlaylistForImport(
        context,
        guildId,
        name,
        userId,
      );

      try {
        const importedPlaylist =
          subcommand === 'import-youtube'
            ? await context.player.search(url, {
                requestedBy: context.interaction.user,
                searchEngine: context.config.music.youtubeSearchEngine,
              })
            : null;

        if (subcommand === 'import-youtube') {
          if (
            !importedPlaylist ||
            importedPlaylist.isEmpty() ||
            !importedPlaylist.playlist
          ) {
            await context.editReply({
              title: 'Playlist Not Found',
              description:
                'I could not resolve a YouTube playlist from that URL.',
            });
            return;
          }

          const result = await context.musicLibrary.importPlaylistTracks(
            guildId,
            playlist.name,
            importedPlaylist.tracks.map((track) =>
              createSavedTrack(track, userId),
            ),
            mode,
          );

          await context.editReply({
            title: 'YouTube Playlist Imported',
            description: buildImportDescription({
              importedPlaylistName: importedPlaylist.playlist.title,
              importedCount: result.addedCount,
              targetPlaylistName: result.playlist.name,
              mode: result.mode,
              skippedDuplicates: result.skippedDuplicates,
              skippedOverflow: result.skippedOverflow,
              createdPlaylist: created,
            }),
          });
          return;
        }

        const resolvedPlaylist = await resolveSpotifyPlaylistToYoutubeTracks(
          context.player,
          context.config,
          context.interaction.user,
          url,
        );

        if (resolvedPlaylist.resolvedTracks.length === 0) {
          await context.editReply({
            title: 'Playlist Not Found',
            description:
              'I could read that Spotify playlist, but I could not match any of its songs on YouTube.',
          });
          return;
        }

        const result = await context.musicLibrary.importPlaylistTracks(
          guildId,
          playlist.name,
          resolvedPlaylist.resolvedTracks.map((track) =>
            createSavedTrack(track, userId),
          ),
          mode,
        );

        const unresolvedLine =
          resolvedPlaylist.unresolvedTracks.length > 0
            ? `\nSkipped **${resolvedPlaylist.unresolvedTracks.length}** track(s) that I couldn't match on YouTube.`
            : '';

        await context.editReply({
          title: 'Spotify Playlist Imported',
          description: `${buildImportDescription({
            importedPlaylistName: resolvedPlaylist.title,
            importedCount: result.addedCount,
            targetPlaylistName: result.playlist.name,
            mode: result.mode,
            skippedDuplicates: result.skippedDuplicates,
            skippedOverflow: result.skippedOverflow,
            createdPlaylist: created,
          })}${unresolvedLine}`,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown import error.';

        context.logger.error('Failed to import a playlist.', error);
        await context.editReply({
          title: 'Import Failed',
          description: `I couldn't import that playlist.\n\`${message}\``,
        });
      }
      return;
    }
    case 'delete':
    default: {
      if (!(await requirePlaylistEditor(context))) {
        return;
      }

      const name = context.interaction.options.getString('name', true);
      const deleted = await context.musicLibrary.deletePlaylist(guildId, name);

      if (!deleted) {
        await context.replyError(`Playlist **${name}** does not exist.`);
        return;
      }

      await context.replySuccess(`Deleted playlist **${name}**.`);
      return;
    }
  }
};

export const libraryCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('library')
    .setDescription('Manage your saved favorites and server playlists.')
    .setDMPermission(false)
    .addSubcommandGroup((group) =>
      group
        .setName('favorites')
        .setDescription('Manage your saved favorite tracks.')
        .addSubcommand((subcommand) =>
          subcommand
            .setName('add-current')
            .setDescription(
              'Save the currently playing track to your favorites.',
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('add')
            .setDescription(
              'Search YouTube and save the first result to your favorites.',
            )
            .addStringOption((option) =>
              option
                .setName('query')
                .setDescription('A search term or music URL')
                .setRequired(true),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('list')
            .setDescription('List your saved favorites.'),
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
          subcommand
            .setName('clear')
            .setDescription('Clear all of your favorites.'),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('playlists')
        .setDescription('Manage server playlists.')
        .addSubcommand((subcommand) =>
          subcommand
            .setName('create')
            .setDescription('Create a new server playlist.')
            .addStringOption((option) =>
              option
                .setName('name')
                .setDescription('Playlist name')
                .setRequired(true)
                .setMaxLength(50),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand.setName('list').setDescription('List server playlists.'),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('show')
            .setDescription('Show tracks in a server playlist.')
            .addStringOption((option) => applyPlaylistNameOption(option)),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('play')
            .setDescription('Queue every track in a server playlist.')
            .addStringOption((option) => applyPlaylistNameOption(option)),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('add-current')
            .setDescription('Add the current track to a server playlist.')
            .addStringOption((option) => applyPlaylistNameOption(option)),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('add')
            .setDescription(
              'Search YouTube and add the first result to a playlist.',
            )
            .addStringOption((option) => applyPlaylistNameOption(option))
            .addStringOption((option) =>
              option
                .setName('query')
                .setDescription('A search term or music URL')
                .setRequired(true),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('remove')
            .setDescription('Remove a track from a server playlist.')
            .addStringOption((option) => applyPlaylistNameOption(option))
            .addIntegerOption((option) =>
              option
                .setName('position')
                .setDescription('Track position from /library playlists show')
                .setRequired(true)
                .setMinValue(1),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('clear')
            .setDescription('Remove every track from a server playlist.')
            .addStringOption((option) => applyPlaylistNameOption(option)),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('import-queue')
            .setDescription('Save the current queue into a playlist.')
            .addStringOption((option) => applyPlaylistImportNameOption(option)),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('import-youtube')
            .setDescription(
              'Import a YouTube playlist URL into a server playlist.',
            )
            .addStringOption((option) => applyPlaylistImportNameOption(option))
            .addStringOption((option) =>
              option
                .setName('url')
                .setDescription('A YouTube playlist URL')
                .setRequired(true),
            )
            .addStringOption((option) => applyImportModeOption(option)),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('import-spotify')
            .setDescription(
              'Import a Spotify playlist URL into a server playlist.',
            )
            .addStringOption((option) => applyPlaylistImportNameOption(option))
            .addStringOption((option) =>
              option
                .setName('url')
                .setDescription('A Spotify playlist URL')
                .setRequired(true),
            )
            .addStringOption((option) => applyImportModeOption(option)),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('delete')
            .setDescription('Delete a server playlist.')
            .addStringOption((option) => applyPlaylistNameOption(option)),
        ),
    ),
  execute: async (context) => {
    const group = context.interaction.options.getSubcommandGroup(true);
    const subcommand = context.interaction.options.getSubcommand(true);

    if (group === 'favorites') {
      await handleFavorites(context, subcommand);
      return;
    }

    await handlePlaylists(context, subcommand);
  },
  autocomplete: async (context) => {
    const group = context.interaction.options.getSubcommandGroup();
    const subcommand = context.interaction.options.getSubcommand();
    const focused = context.interaction.options.getFocused(true);

    if (group === 'favorites' && focused.name === 'favorite') {
      const favorites = context.musicLibrary.listFavorites(
        context.interaction.user.id,
      );
      const filtered = favorites
        .map((track, index) => ({
          name: `${index + 1}. ${track.title}`.slice(0, 100),
          value: String(index + 1),
        }))
        .filter((choice) =>
          choice.name
            .toLowerCase()
            .includes(String(focused.value).toLowerCase()),
        )
        .slice(0, 25);

      await context.interaction.respond(filtered);
      return;
    }

    if (
      group === 'playlists' &&
      focused.name === 'name' &&
      subcommand !== 'import-queue' &&
      subcommand !== 'import-youtube' &&
      subcommand !== 'import-spotify'
    ) {
      const playlists = context.musicLibrary.listPlaylists(
        context.interaction.guildId,
      );
      const filtered = playlists
        .filter((playlist) =>
          playlist.name
            .toLowerCase()
            .includes(String(focused.value).toLowerCase()),
        )
        .slice(0, 25)
        .map((playlist) => ({
          name: `${playlist.name} (${playlist.tracks.length})`.slice(0, 100),
          value: playlist.name,
        }));

      await context.interaction.respond(filtered);
      return;
    }

    await context.interaction.respond([]);
  },
};

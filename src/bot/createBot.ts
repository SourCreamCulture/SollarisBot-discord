import { ensureGuildCommandAccess } from '../utils/guildPermissions';
import {
  Client,
  Events,
  GatewayIntentBits,
  type GuildTextBasedChannel,
  type Interaction,
  type VoiceBasedChannel,
} from 'discord.js';
import { GuildQueueEvent } from 'discord-player';

import { createTrackerApexApiClient } from '../apex/client';
import { createMozambiqueApexApiClient } from '../apex/mozambiqueClient';
import { createApexService } from '../apex/service';
import { createJsonApexLinkStore } from '../apex/store';
import { createJsonApexWatchStore } from '../apex/watchStore';
import { ApexError } from '../apex/types';
import { createValorantHenrikClient } from '../valorant/henrikClient';
import { ValorantLeaderboardManager } from '../valorant/leaderboardManager';
import { createJsonValorantLeaderboardStateStore } from '../valorant/leaderboardStore';
import { createValorantService } from '../valorant/service';
import { createJsonValorantLinkStore } from '../valorant/store';
import { createValorantStaticClient } from '../valorant/staticClient';
import { commandMap, djCommandNames, musicCommandNames } from '../commands';
import type { BotConfig } from '../types/bot';
import {
  createAutocompleteContext,
  createCommandContext,
} from '../utils/interaction';
import type { Logger } from '../utils/logger';
import { UserFacingError } from '../utils/errors';
import {
  createMusicPlayer,
  getGuildSession,
  restoreSavedQueue,
} from '../music/service';
import { handleMusicSearchSelect } from '../music/searchInteractions';
import { createJsonMusicLibraryService } from '../music/library';
import { QueueVoteManager } from '../music/queueVoting';
import { createJsonMusicStatsService } from '../music/stats';
import { MusicPanelManager } from '../music/panel';
import {
  createJsonQueueStateService,
  createQueueSnapshot,
} from '../music/queueState';
import { createJsonMusicSettingsService } from '../music/settings';
import { VoteSkipManager } from '../music/voteSkip';
import { createJsonUtilityStore } from '../utils/utilityStore';
import { UtilityInteractionManager } from '../utils/utilityInteractions';
import {
  ensureMusicTextChannel,
  requireDjOrOpenControl,
} from '../music/permissions';

export const createBot = async (config: BotConfig, logger: Logger) => {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });

  const voteSkips = new VoteSkipManager();
  const queueVotes = new QueueVoteManager();
  const player = await createMusicPlayer(client, config, logger, voteSkips);
  const musicLibrary = await createJsonMusicLibraryService(
    config.music.libraryFile,
    logger,
  );
  const musicStats = await createJsonMusicStatsService(
    config.music.statsFile,
    logger,
  );
  const queueState = await createJsonQueueStateService(
    config.music.queueStateFile,
    logger,
    { restoreMaxAgeMs: config.music.queueRestoreMaxAgeMs },
  );
  const musicSettings = await createJsonMusicSettingsService(
    config.music.settingsFile,
    config,
    logger,
  );
  const musicPanel = new MusicPanelManager(
    player,
    logger,
    queueState,
    musicSettings,
  );
  const apexLinkStore = await createJsonApexLinkStore(
    config.apex.linksFile,
    logger,
  );
  const apexWatchStore = await createJsonApexWatchStore(
    config.apex.watchFile,
    logger,
  );
  const valorantLinkStore = await createJsonValorantLinkStore(
    config.valorant.linksFile,
    logger,
  );
  const valorantLeaderboardStateStore =
    await createJsonValorantLeaderboardStateStore(
      config.valorant.leaderboardStateFile,
      logger,
    );
  const utilityStore = await createJsonUtilityStore(
    config.utility.storeFile,
    logger,
  );
  const utilityInteractions = new UtilityInteractionManager(
    utilityStore,
    logger,
  );
  const apexClient =
    config.apex.provider === 'mozambique'
      ? createMozambiqueApexApiClient(
          config.apex.mozambiqueApiKey ?? '',
          logger,
        )
      : createTrackerApexApiClient(config.apex.trackerApiKey ?? '', logger);
  const apexService = createApexService({
    client: apexClient,
    store: apexLinkStore,
    watchStore: apexWatchStore,
  });
  const valorantService = createValorantService({
    staticClient: createValorantStaticClient(logger),
    henrikClient: createValorantHenrikClient(
      config.valorant.henrikDevApiKey,
      logger,
    ),
    store: valorantLinkStore,
  });
  const valorantLeaderboard = new ValorantLeaderboardManager(
    valorantService,
    valorantLinkStore,
    valorantLeaderboardStateStore,
    logger,
    {
      channelId: config.valorant.leaderboardChannelId,
      guildSettings: utilityStore,
      refreshIntervalMs: config.valorant.leaderboardRefreshIntervalMs,
    },
  );

  client.once(Events.ClientReady, (readyClient) => {
    logger.info(`Logged in as ${readyClient.user.tag}.`);
    utilityInteractions.startReminderLoop(readyClient);
    valorantLeaderboard.start(readyClient);
    void (async () => {
      for (const state of queueState.getAll()) {
        try {
          const settings = musicSettings.getSettings(state.guildId);
          const voiceChannel = await client.channels.fetch(
            state.voiceChannelId,
          );
          const textChannel = await client.channels.fetch(state.textChannelId);

          if (!voiceChannel?.isVoiceBased() || !textChannel?.isTextBased()) {
            await queueState.clear(state.guildId);
            continue;
          }

          await restoreSavedQueue(
            player,
            config,
            settings,
            voiceChannel as VoiceBasedChannel,
            textChannel as GuildTextBasedChannel,
            state,
          );

          const restoredQueue = getGuildSession(player, state.guildId);

          if (restoredQueue) {
            await musicPanel.render(restoredQueue);
          }
        } catch (error) {
          logger.warn(
            `Failed to restore queue state for guild ${state.guildId}. Clearing saved state.`,
            error,
          );
          await queueState.clear(state.guildId);
        }
      }
    })();
  });

  const handleInteraction = async (interaction: Interaction) => {
    if (
      await handleMusicSearchSelect(
        interaction,
        player,
        musicSettings,
        config,
        logger,
      )
    ) {
      return;
    }

    if (
      await musicPanel.handleButton(
        interaction,
        musicSettings,
        musicLibrary,
        voteSkips,
      )
    ) {
      return;
    }

    if (await utilityInteractions.handleButton(interaction)) {
      return;
    }

    if (interaction.isAutocomplete() && interaction.inCachedGuild()) {
      const command = commandMap.get(interaction.commandName);

      if (!command?.autocomplete) {
        return;
      }

      const context = createAutocompleteContext(
        interaction,
        player,
        apexService,
        valorantService,
        musicLibrary,
        musicStats,
        musicSettings,
        queueState,
        queueVotes,
        voteSkips,
        utilityStore,
        config,
        logger,
      );

      try {
        await command.autocomplete(context);
      } catch (error) {
        logger.error(
          `Autocomplete failed for /${interaction.commandName}`,
          error,
        );
      }

      return;
    }

    if (!interaction.isChatInputCommand() || !interaction.inCachedGuild()) {
      return;
    }

    const command = commandMap.get(interaction.commandName);

    if (!command) {
      logger.warn(`Received unknown command: ${interaction.commandName}`);
      await interaction.reply({
        content:
          'This command is not available in the running bot version yet. Restart the bot and try again.',
        ephemeral: true,
      });
      return;
    }

    const context = createCommandContext(
      interaction,
      player,
      apexService,
      valorantService,
      musicLibrary,
      musicStats,
      musicSettings,
      queueState,
      queueVotes,
      voteSkips,
      utilityStore,
      config,
      logger,
    );

    try {
      if (!(await ensureGuildCommandAccess(context))) return;
      if (
        musicCommandNames.has(interaction.commandName) &&
        !(await ensureMusicTextChannel(context))
      ) {
        return;
      }

      if (
        djCommandNames.has(interaction.commandName) &&
        !(await requireDjOrOpenControl(context, 'control music playback'))
      ) {
        return;
      }

      await command.execute(context);
    } catch (error) {
      logger.error(
        `Command execution failed for /${interaction.commandName}`,
        error,
      );

      // Only surface messages that were deliberately written for users.
      // Anything else is unexpected: it has been logged above, and the user
      // sees a generic message so internal details never leak to Discord.
      const content =
        error instanceof UserFacingError || error instanceof ApexError
          ? error.message
          : 'Something went wrong while running this command. The error has been logged.';

      if (interaction.deferred) {
        await interaction.editReply({ content });
        return;
      }

      if (interaction.replied) {
        await interaction.followUp({ content, ephemeral: true });
        return;
      }

      await interaction.reply({ content, ephemeral: true });
    }
  };

  client.on(Events.InteractionCreate, (interaction) => {
    void handleInteraction(interaction).catch((error) =>
      logger.error('Interaction handling failed.', error),
    );
  });

  client.on(Events.Error, (error) => {
    logger.error('Discord client error encountered.', error);
  });

  player.events.on(GuildQueueEvent.PlayerStart, (queue) => {
    const snapshot = createQueueSnapshot(queue);
    if (snapshot) {
      void queueState.save(snapshot);
    }
    queueVotes.clearGuild(queue.guild.id);
    if (queue.currentTrack) {
      void musicStats.recordTrackStart(queue.guild.id, queue.currentTrack);
    }
    void musicPanel.render(queue);
  });

  player.events.on(GuildQueueEvent.PlayerPause, (queue) => {
    void musicPanel.render(queue);
  });

  player.events.on(GuildQueueEvent.PlayerResume, (queue) => {
    void musicPanel.render(queue);
  });

  player.events.on(GuildQueueEvent.AudioTrackAdd, (queue) => {
    const snapshot = createQueueSnapshot(queue);
    if (snapshot) {
      void queueState.save(snapshot);
    }
    void musicPanel.render(queue);
  });

  player.events.on(GuildQueueEvent.AudioTracksAdd, (queue) => {
    const snapshot = createQueueSnapshot(queue);
    if (snapshot) {
      void queueState.save(snapshot);
    }
    void musicPanel.render(queue);
  });

  player.events.on(GuildQueueEvent.AudioTrackRemove, (queue) => {
    const snapshot = createQueueSnapshot(queue);
    if (snapshot) {
      void queueState.save(snapshot);
    }
    void musicPanel.render(queue);
  });

  player.events.on(GuildQueueEvent.AudioTracksRemove, (queue) => {
    const snapshot = createQueueSnapshot(queue);
    if (snapshot) {
      void queueState.save(snapshot);
    }
    void musicPanel.render(queue);
  });

  player.events.on(GuildQueueEvent.VolumeChange, (queue) => {
    const snapshot = createQueueSnapshot(queue);
    if (snapshot) {
      void queueState.save(snapshot);
    }
    void musicPanel.render(queue);
  });

  player.events.on(GuildQueueEvent.EmptyQueue, (queue) => {
    const settings = musicSettings.getSettings(queue.guild.id);
    const snapshot = createQueueSnapshot(queue);
    if (settings.twentyFourSevenEnabled && snapshot) {
      void queueState.save(snapshot);
    } else {
      void queueState.clear(queue.guild.id);
    }
    void musicPanel.disable(
      queue,
      'Queue finished. Start another song to create a fresh control panel.',
    );
  });

  player.events.on(GuildQueueEvent.Disconnect, (queue) => {
    void queueState.clear(queue.guild.id);
    void musicPanel.disable(
      queue,
      'Disconnected from voice. Start another song to create a fresh control panel.',
    );
  });

  const shutdown = async (reason: string): Promise<void> => {
    logger.info(`Shutting down after ${reason}. Saving active queue state.`);

    for (const queue of player.nodes.cache.values()) {
      const settings = musicSettings.getSettings(queue.guild.id);
      const snapshot = createQueueSnapshot(queue);

      if (
        snapshot &&
        (settings.twentyFourSevenEnabled ||
          snapshot.currentTrack ||
          snapshot.upcomingTracks.length > 0)
      ) {
        await queueState.save(snapshot);
      } else {
        await queueState.clear(queue.guild.id);
      }
    }

    await utilityInteractions.stop();
    await valorantLeaderboard.stop();
    client.destroy();
  };

  return { client, player, shutdown };
};

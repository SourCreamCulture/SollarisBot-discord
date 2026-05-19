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
import { commandMap, djCommandNames, musicCommandNames } from '../commands';
import type { BotConfig } from '../types/bot';
import { createAutocompleteContext, createCommandContext } from '../utils/interaction';
import type { Logger } from '../utils/logger';
import {
  createMusicPlayer,
  restoreSavedQueue,
} from '../music/service';
import { handleMusicSearchSelect } from '../music/searchInteractions';
import { createJsonMusicLibraryService } from '../music/library';
import { MusicPanelManager } from '../music/panel';
import { createJsonQueueStateService, createQueueSnapshot } from '../music/queueState';
import { createJsonMusicSettingsService } from '../music/settings';
import { VoteSkipManager } from '../music/voteSkip';
import {
  ensureMusicTextChannel,
  requireDjOrOpenControl,
} from '../music/permissions';

export const createBot = async (config: BotConfig, logger: Logger) => {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });

  const voteSkips = new VoteSkipManager();
  const player = await createMusicPlayer(client, config, logger, voteSkips);
  const musicPanel = new MusicPanelManager(player, logger);
  const musicLibrary = await createJsonMusicLibraryService(
    config.music.libraryFile,
    logger,
  );
  const queueState = await createJsonQueueStateService(
    config.music.queueStateFile,
    logger,
  );
  const musicSettings = await createJsonMusicSettingsService(
    config.music.settingsFile,
    config,
    logger,
  );
  const apexLinkStore = await createJsonApexLinkStore(config.apex.linksFile, logger);
  const apexClient =
    config.apex.provider === 'mozambique'
      ? createMozambiqueApexApiClient(config.apex.mozambiqueApiKey ?? '', logger)
      : createTrackerApexApiClient(config.apex.trackerApiKey ?? '', logger);
  const apexService = createApexService({
    client: apexClient,
    store: apexLinkStore,
  });

  client.once(Events.ClientReady, (readyClient) => {
    logger.info(`Logged in as ${readyClient.user.tag}.`);
    void (async () => {
      for (const state of queueState.getAll()) {
        try {
          const settings = musicSettings.getSettings(state.guildId);
          const voiceChannel = await client.channels.fetch(state.voiceChannelId);
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

  const handleInteraction = async (
    interaction: Interaction,
  ) => {
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

    if (await musicPanel.handleButton(interaction, musicSettings)) {
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
        musicLibrary,
        musicSettings,
        queueState,
        voteSkips,
        config,
        logger,
      );

      try {
        await command.autocomplete(context);
      } catch (error) {
        logger.error(`Autocomplete failed for /${interaction.commandName}`, error);
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
      musicLibrary,
      musicSettings,
      queueState,
      voteSkips,
      config,
      logger,
    );

    try {
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
      logger.error(`Command execution failed for /${interaction.commandName}`, error);

      const message =
        error instanceof Error ? error.message : 'Unknown command failure.';

      if (interaction.deferred) {
        await interaction.editReply({
          content: `Something went wrong while running this command: ${message}`,
        });
        return;
      }

      if (interaction.replied) {
        await interaction.followUp({
          content: `Something went wrong while running this command: ${message}`,
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        content: `Something went wrong while running this command: ${message}`,
        ephemeral: true,
      });
    }
  };

  client.on(Events.InteractionCreate, (interaction) => {
    void handleInteraction(interaction);
  });

  client.on(Events.Error, (error) => {
    logger.error('Discord client error encountered.', error);
  });

  player.events.on(GuildQueueEvent.PlayerStart, (queue) => {
    const snapshot = createQueueSnapshot(queue);
    if (snapshot) {
      void queueState.save(snapshot);
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

  return { client, player };
};

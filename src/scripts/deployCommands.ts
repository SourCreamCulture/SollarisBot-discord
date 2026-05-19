import { REST, Routes } from 'discord.js';

import { commands } from '../commands';
import { loadConfig } from '../config/env';
import { createLogger } from '../utils/logger';

const deployCommands = async (): Promise<void> => {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  const body = commands.map((command) => command.data.toJSON());

  if (config.discordGuildId) {
    logger.info(
      `Deploying ${body.length} guild commands to guild ${config.discordGuildId}.`,
    );
    await rest.put(
      Routes.applicationGuildCommands(
        config.discordClientId,
        config.discordGuildId,
      ),
      { body },
    );
    logger.info('Guild command deployment complete.');
    return;
  }

  logger.info(`Deploying ${body.length} global commands.`);
  await rest.put(Routes.applicationCommands(config.discordClientId), { body });
  logger.info('Global command deployment complete.');
};

void deployCommands().catch((error) => {
  console.error('Failed to deploy slash commands.', error);
  process.exitCode = 1;
});

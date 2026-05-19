import { createBot } from './bot/createBot';
import { loadConfig } from './config/env';
import { createLogger } from './utils/logger';

const main = async (): Promise<void> => {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const { client } = await createBot(config, logger);

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection encountered.', reason);
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception encountered.', error);
  });

  await client.login(config.discordToken);
};

void main().catch((error) => {
  console.error('Bot startup failed.', error);
  process.exitCode = 1;
});

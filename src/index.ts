import { createBot } from './bot/createBot';
import { loadConfig } from './config/env';
import { createLogger } from './utils/logger';

const main = async (): Promise<void> => {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const { client, shutdown } = await createBot(config, logger);

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection encountered.', reason);
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception encountered.', error);
  });

  const handleShutdownSignal = (signal: string): void => {
    void shutdown(signal)
      .catch((error) => {
        logger.error(`Failed to shut down cleanly after ${signal}.`, error);
      })
      .finally(() => {
        process.exit(0);
      });
  };

  process.once('SIGINT', handleShutdownSignal);
  process.once('SIGTERM', handleShutdownSignal);

  await client.login(config.discordToken);
};

void main().catch((error) => {
  console.error('Bot startup failed.', error);
  process.exitCode = 1;
});

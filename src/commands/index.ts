import type { CommandModule } from '../types/bot';
import { apexCommand } from './apex';
import { libraryCommand } from './library';
import { musicCommand } from './music';
import { playCommand } from './play';
import { playerCommand } from './player';
import { queueCommand } from './queue';

export const commands: CommandModule[] = [
  apexCommand,
  playCommand,
  playerCommand,
  queueCommand,
  libraryCommand,
  musicCommand,
];

export const commandMap = new Map(
  commands.map((command) => [command.data.name, command]),
);

export const musicCommandNames = new Set([
  'play',
  'player',
  'queue',
  'library',
  'music',
]);

export const djCommandNames = new Set<string>();

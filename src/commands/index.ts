import type { CommandModule } from '../types/bot';
import { apexCommand } from './apex';
import { botCommand } from './bot';
import { eventCommand } from './event';
import { libraryCommand } from './library';
import { musicCommand } from './music';
import { playCommand } from './play';
import { pollCommand } from './poll';
import { playerCommand } from './player';
import { queueCommand } from './queue';
import { remindCommand } from './remind';
import { rollCommand } from './roll';
import { valorantCommand } from './valorant';

export const commands: CommandModule[] = [
  apexCommand,
  botCommand,
  playCommand,
  playerCommand,
  queueCommand,
  libraryCommand,
  musicCommand,
  pollCommand,
  remindCommand,
  rollCommand,
  eventCommand,
  valorantCommand,
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

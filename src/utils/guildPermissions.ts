import { PermissionFlagsBits } from 'discord.js';
import type { CommandContext } from '../types/bot';
import type { GuildSettings, SettingTarget } from './utilityStore';

export const commandTarget = (
  name: string,
  subcommand: string | null,
): SettingTarget | null =>
  (name === 'apex' || name === 'valorant') && subcommand === 'lfg'
    ? 'lfg'
    : ['apex', 'valorant', 'event', 'poll', 'remind', 'roll'].includes(name)
      ? (name as SettingTarget)
      : null;

export const restrictionError = (
  settings: GuildSettings,
  target: SettingTarget,
  channelId: string,
  roleIds: string[],
  manageGuild: boolean,
): string | null => {
  const channel = settings.commandChannels[target];
  if (channel && channel !== channelId)
    return `Use this command in <#${channel}>. Server admins can change this with /settings channel.`;
  const role = settings.commandRoles[target];
  if (role && !manageGuild && !roleIds.includes(role))
    return `This command requires the <@&${role}> role.`;
  return null;
};

export const ensureGuildCommandAccess = async (
  context: CommandContext,
): Promise<boolean> => {
  const target = commandTarget(
    context.interaction.commandName,
    context.interaction.options.getSubcommand(false),
  );
  if (!target) return true;
  const error = restrictionError(
    context.utilityStore.getGuildSettings(context.interaction.guildId),
    target,
    context.interaction.channelId,
    [...context.interaction.member.roles.cache.keys()],
    context.interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild),
  );
  if (!error) return true;
  await context.replyError(error);
  return false;
};

import { PermissionFlagsBits } from 'discord.js';

import type { CommandContext } from '../types/bot';
import { resolveMember } from './guards';

export const requireDjOrOpenControl = async (
  context: CommandContext,
  action: string,
): Promise<boolean> => {
  const settings = context.musicSettings.getSettings(
    context.interaction.guildId,
  );

  if (!settings.djRoleId) {
    return true;
  }

  const member = await resolveMember(context.interaction);

  if (
    member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    member.roles.cache.has(settings.djRoleId)
  ) {
    return true;
  }

  await context.replyError(
    `Only members with the <@&${settings.djRoleId}> role can ${action}. Use \`/player voteskip\` for shared skips.`,
  );
  return false;
};

export const ensureMusicTextChannel = async (
  context: CommandContext,
): Promise<boolean> => {
  const settings = context.musicSettings.getSettings(
    context.interaction.guildId,
  );

  if (
    !settings.textChannelId ||
    settings.textChannelId === context.interaction.channelId ||
    context.interaction.commandName === 'music'
  ) {
    return true;
  }

  await context.replyError(
    `Music commands are bound to <#${settings.textChannelId}> in this server.`,
  );
  return false;
};

import type { CommandContext } from '../types/bot';
import { buildLfgPayload } from './utilityInteractions';
import type { SavedLfg } from './utilityStore';

export const postLfg = async (
  context: CommandContext,
  game: SavedLfg['game'],
  needed: number,
  description: string,
): Promise<void> => {
  const { interaction, utilityStore } = context;
  const settings = utilityStore.getGuildSettings(interaction.guildId);
  const lfg = await utilityStore.addLfg({
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    game,
    createdById: interaction.user.id,
    description,
    capacity: needed + 1,
    expiresAt: new Date(
      Date.now() + settings.lfgExpiryMinutes * 60000,
    ).toISOString(),
  });
  const message = await interaction.editReply(buildLfgPayload(lfg));
  await utilityStore.setLfgMessage(lfg.id, message.id);
};

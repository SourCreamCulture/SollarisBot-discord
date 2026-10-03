import type { UtilityStore } from '../utils/utilityStore';
import {
  EmbedBuilder,
  type Client,
  type GuildTextBasedChannel,
  type Message,
} from 'discord.js';
import { setInterval, clearInterval } from 'node:timers';

import type { Logger } from '../utils/logger';
import {
  ValorantError,
  type ValorantBaseCard,
  type ValorantLeaderboardCard,
  type ValorantLeaderboardDisplayName,
  type ValorantLinkStore,
  type ValorantService,
} from './types';
import type { ValorantLeaderboardStateStore } from './leaderboardStore';

const VALORANT_COLOR = 0xff4655;
const DEFAULT_SORT = 'rank';
const DEFAULT_SIZE = 10;

interface ValorantLeaderboardManagerOptions {
  channelId?: string;
  refreshIntervalMs: number;
  guildSettings?: UtilityStore;
}

const buildEmbed = (
  card: ValorantBaseCard,
  refreshIntervalMs: number,
): EmbedBuilder =>
  new EmbedBuilder()
    .setColor(card.color)
    .setTitle(card.title)
    .setDescription(card.description)
    .addFields(card.fields)
    .setFooter({
      text: `${card.footer} - Updates every ${Math.round(
        refreshIntervalMs / 60_000,
      )} minutes`,
    })
    .setTimestamp();

export class ValorantLeaderboardManager {
  private timer: ReturnType<typeof setInterval> | null = null;
  private refreshChain = Promise.resolve();
  private readonly lastRefresh = new Map<string, number>();
  private migrationPromise: Promise<void> | null = null;

  constructor(
    private readonly service: ValorantService,
    private readonly linkStore: ValorantLinkStore,
    private readonly stateStore: ValorantLeaderboardStateStore,
    private readonly logger: Logger,
    private readonly options: ValorantLeaderboardManagerOptions,
  ) {}

  start(client: Client<true>): void {
    if (this.timer) return;
    this.migrationPromise = this.migrateLegacyChannel(client);
    const tick = () => {
      void this.refresh(client).catch((error) =>
        this.logger.warn('Valorant leaderboard refresh failed.', error),
      );
    };
    tick();
    this.timer = setInterval(
      tick,
      this.options.guildSettings ? 60000 : this.options.refreshIntervalMs,
    );
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.refreshChain.catch(() => undefined);
  }

  private async migrateLegacyChannel(client: Client<true>): Promise<void> {
    const store = this.options.guildSettings;
    if (!store || !this.options.channelId) return;
    try {
      const channel = await client.channels.fetch(this.options.channelId);
      if (!channel || !('guildId' in channel) || !channel.guildId) return;
      if (
        store.getAllGuildSettings().some((s) => s.guildId === channel.guildId)
      )
        return;
      await store.updateGuildSettings(channel.guildId, {
        leaderboardChannelId: channel.id,
        leaderboardRefreshMinutes: Math.min(
          1440,
          Math.max(1, Math.round(this.options.refreshIntervalMs / 60000)),
        ),
      });
      this.logger.info(
        'Migrated legacy Valorant leaderboard channel to guild settings.',
      );
    } catch (error) {
      this.logger.warn('Could not migrate legacy leaderboard channel.', error);
    }
  }

  async refresh(client: Client<true>): Promise<void> {
    this.refreshChain = this.refreshChain
      .catch(() => undefined)
      .then(async () => {
        await this.migrationPromise;
        if (!this.options.guildSettings) {
          if (this.options.channelId)
            await this.render(
              client,
              this.options.channelId,
              this.options.refreshIntervalMs,
            );
          return;
        }
        for (const settings of this.options.guildSettings.getAllGuildSettings()) {
          if (
            !settings.leaderboardChannelId ||
            !client.guilds.cache.has(settings.guildId)
          )
            continue;
          const key = `${settings.guildId}:${settings.leaderboardChannelId}:${settings.leaderboardRefreshMinutes}`;
          const refreshIntervalMs = settings.leaderboardRefreshMinutes * 60000;
          if (Date.now() - (this.lastRefresh.get(key) ?? 0) < refreshIntervalMs)
            continue;
          try {
            await this.render(
              client,
              settings.leaderboardChannelId,
              refreshIntervalMs,
              settings.guildId,
            );
            this.lastRefresh.set(key, Date.now());
          } catch (error) {
            this.logger.warn(
              `Leaderboard refresh failed for guild ${settings.guildId}.`,
              error,
            );
          }
        }
      });
    await this.refreshChain;
  }

  private async render(
    client: Client<true>,
    channelId: string,
    refreshIntervalMs: number,
    guildId?: string,
  ): Promise<void> {
    const channel = await client.channels.fetch(channelId);

    if (
      !channel?.isTextBased() ||
      !('send' in channel) ||
      (guildId && (!('guildId' in channel) || channel.guildId !== guildId))
    ) {
      this.logger.warn(
        `Valorant leaderboard channel ${channelId} is not a sendable text channel.`,
      );
      return;
    }

    const textChannel = channel as GuildTextBasedChannel;
    const members = await this.getGuildLinkedMembers(textChannel);
    const existing = this.stateStore.getState(channelId);
    const card = await this.buildLeaderboardCard(members, existing?.snapshots);
    const embed = buildEmbed(card, refreshIntervalMs);

    if (existing) {
      const message = await this.fetchMessage(textChannel, existing.messageId);

      if (message) {
        await message.edit({ embeds: [embed] });
        await this.stateStore.setState({
          channelId,
          messageId: message.id,
          updatedAt: new Date().toISOString(),
          snapshots: card.snapshots ?? {},
        });
        return;
      }

      await this.stateStore.deleteState(channelId);
    }

    const message = await textChannel.send({ embeds: [embed] });
    await this.stateStore.setState({
      channelId,
      messageId: message.id,
      updatedAt: new Date().toISOString(),
      snapshots: card.snapshots ?? {},
    });
  }

  private async buildLeaderboardCard(
    members:
      | {
          discordUserIds: string[];
          displayNames: ValorantLeaderboardDisplayName[];
        }
      | undefined,
    previousSnapshots?: ValorantLeaderboardCard['snapshots'],
  ): Promise<ValorantLeaderboardCard> {
    try {
      const card = await this.service.getLeaderboardCard({
        sortBy: DEFAULT_SORT,
        size: DEFAULT_SIZE,
        discordUserIds: members?.discordUserIds,
        displayNames: members?.displayNames,
        previousSnapshots: previousSnapshots ?? {},
      });

      return card;
    } catch (error) {
      if (error instanceof ValorantError && error.code === 'not_found') {
        return {
          title: 'Valorant Server Leaderboard',
          description:
            'No linked Valorant accounts are available yet. Use `/valorant link` to join the leaderboard.',
          color: VALORANT_COLOR,
          fields: [],
          footer: 'Linked account leaderboard',
          snapshots: {},
        };
      }

      throw error;
    }
  }

  private async getGuildLinkedMembers(channel: GuildTextBasedChannel): Promise<
    | {
        discordUserIds: string[];
        displayNames: ValorantLeaderboardDisplayName[];
      }
    | undefined
  > {
    const links = this.linkStore.getAllLinks();

    if (links.length === 0) {
      return { discordUserIds: [], displayNames: [] };
    }

    try {
      const results = await Promise.all(
        links.map(async (link) => {
          try {
            const member = await channel.guild.members.fetch({
              user: link.discordUserId,
              force: false,
            });
            return {
              discordUserId: link.discordUserId,
              displayName: member.displayName,
            };
          } catch {
            return null;
          }
        }),
      );
      const displayNames = results.filter(
        (member): member is ValorantLeaderboardDisplayName => Boolean(member),
      );

      return {
        discordUserIds: displayNames.map((member) => member.discordUserId),
        displayNames,
      };
    } catch (error) {
      this.logger.warn(
        'Could not filter Valorant leaderboard links by guild membership. Skipping unverified accounts.',
        error,
      );
      return { discordUserIds: [], displayNames: [] };
    }
  }

  private async fetchMessage(
    channel: GuildTextBasedChannel,
    messageId: string,
  ): Promise<Message<true> | null> {
    try {
      return await channel.messages.fetch(messageId);
    } catch {
      return null;
    }
  }
}

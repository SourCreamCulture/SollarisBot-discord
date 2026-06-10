import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ValorantLeaderboardManager } from '../src/valorant/leaderboardManager';
import type {
  ValorantLeaderboardMessageState,
  ValorantLeaderboardStateStore,
} from '../src/valorant/leaderboardStore';
import type { Logger } from '../src/utils/logger';
import type {
  ValorantLeaderboardCard,
  ValorantLeaderboardSnapshot,
  ValorantLinkStore,
  ValorantLinkedAccount,
  ValorantService,
} from '../src/valorant/types';

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

class InMemoryValorantLeaderboardStateStore implements ValorantLeaderboardStateStore {
  private readonly states = new Map<string, ValorantLeaderboardMessageState>();

  getState(channelId: string): ValorantLeaderboardMessageState | null {
    const state = this.states.get(channelId);

    return state
      ? {
          ...state,
          snapshots: Object.fromEntries(
            Object.entries(state.snapshots).map(([key, snapshot]) => [
              key,
              { ...snapshot },
            ]),
          ),
        }
      : null;
  }

  async setState(state: ValorantLeaderboardMessageState): Promise<void> {
    this.states.set(state.channelId, {
      ...state,
      snapshots: Object.fromEntries(
        Object.entries(state.snapshots).map(([key, snapshot]) => [
          key,
          { ...snapshot },
        ]),
      ),
    });
  }

  async deleteState(channelId: string): Promise<boolean> {
    return this.states.delete(channelId);
  }
}

class StaticValorantLinkStore implements ValorantLinkStore {
  constructor(private readonly links: ValorantLinkedAccount[]) {}

  getLink(discordUserId: string): ValorantLinkedAccount | null {
    return (
      this.links.find((link) => link.discordUserId === discordUserId) ?? null
    );
  }

  getAllLinks(): ValorantLinkedAccount[] {
    return this.links.map((link) => ({ ...link }));
  }

  async setLink(): Promise<void> {
    throw new Error('Not implemented.');
  }

  async deleteLink(): Promise<boolean> {
    throw new Error('Not implemented.');
  }
}

const createSnapshot = (rr: number): ValorantLeaderboardSnapshot => ({
  discordUserId: 'user-1',
  name: 'Player',
  tag: 'NA1',
  region: 'na',
  platform: 'pc',
  rank: 'Gold 2',
  rr,
  elo: 1000 + rr,
  leaderboardPosition: 1,
});

const createCard = (rr: number): ValorantLeaderboardCard => ({
  title: 'Valorant Server Leaderboard',
  description: 'Sorted by **RANK**.',
  color: 0xff4655,
  fields: [
    {
      name: '1. Player#NA1',
      value: `<@user-1> - Gold 2 - ${rr} RR`,
      inline: false,
    },
  ],
  footer: 'Valorant utility',
  snapshots: {
    'user-1': createSnapshot(rr),
  },
});

describe('ValorantLeaderboardManager', () => {
  it('persists snapshots and passes them into the next refresh', async () => {
    const previousSnapshots: Array<
      Record<string, ValorantLeaderboardSnapshot> | undefined
    > = [];
    const cards = [createCard(50), createCard(62)];
    const service = {
      getLeaderboardCard: async (input: {
        previousSnapshots?: Record<string, ValorantLeaderboardSnapshot>;
      }) => {
        previousSnapshots.push(input.previousSnapshots);
        return cards.shift() ?? createCard(62);
      },
    } as unknown as ValorantService;
    const linkStore = new StaticValorantLinkStore([
      {
        discordUserId: 'user-1',
        name: 'Player',
        tag: 'NA1',
        region: 'na',
        platform: 'pc',
        linkedAt: '2026-06-04T00:00:00.000Z',
        updatedAt: '2026-06-04T00:00:00.000Z',
      },
    ]);
    const stateStore = new InMemoryValorantLeaderboardStateStore();
    const message = {
      id: 'message-1',
      edit: async () => undefined,
    };
    const channel = {
      isTextBased: () => true,
      send: async () => message,
      messages: {
        fetch: async () => message,
      },
      guild: {
        members: {
          fetch: async ({ user }: { user: string }) => ({
            displayName: `Display ${user}`,
          }),
        },
      },
    };
    const client = {
      channels: {
        fetch: async () => channel,
      },
    };
    const manager = new ValorantLeaderboardManager(
      service,
      linkStore,
      stateStore,
      logger,
      {
        channelId: 'channel-1',
        refreshIntervalMs: 600_000,
      },
    );

    await manager.refresh(client as never);
    await manager.refresh(client as never);

    assert.deepEqual(previousSnapshots[0], {});
    assert.equal(previousSnapshots[1]?.['user-1']?.rr, 50);
    assert.equal(stateStore.getState('channel-1')?.snapshots['user-1']?.rr, 62);
  });
});

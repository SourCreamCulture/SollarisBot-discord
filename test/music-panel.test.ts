import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { QueueRepeatMode } from 'discord-player';

import {
  MusicPanelManager,
  RESTORABLE_MUSIC_PANEL_GUILD_ID,
} from '../src/music/panel';
import type {
  PersistedQueueState,
  QueueStateService,
} from '../src/music/queueState';
import type { GuildMusicSession } from '../src/types/bot';
import type { Logger } from '../src/utils/logger';

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const cloneState = (state: PersistedQueueState): PersistedQueueState =>
  JSON.parse(JSON.stringify(state)) as PersistedQueueState;

class MemoryQueueStateService implements QueueStateService {
  private readonly states = new Map<string, PersistedQueueState>();

  constructor(states: PersistedQueueState[] = []) {
    for (const state of states) {
      this.states.set(state.guildId, cloneState(state));
    }
  }

  getAll(): PersistedQueueState[] {
    return [...this.states.values()].map((state) => cloneState(state));
  }

  get(guildId: string): PersistedQueueState | null {
    const state = this.states.get(guildId);
    return state ? cloneState(state) : null;
  }

  async save(state: PersistedQueueState): Promise<void> {
    this.states.set(state.guildId, cloneState(state));
  }

  async clear(guildId: string): Promise<void> {
    this.states.delete(guildId);
  }
}

const createState = (
  overrides: Partial<PersistedQueueState> = {},
): PersistedQueueState => ({
  guildId: RESTORABLE_MUSIC_PANEL_GUILD_ID,
  textChannelId: 'text-1',
  voiceChannelId: 'voice-1',
  currentTrack: null,
  upcomingTracks: [],
  volume: 70,
  repeatMode: QueueRepeatMode.OFF,
  updatedAt: '2026-06-03T00:00:00.000Z',
  ...overrides,
});

const createMessage = (id: string, channelId: string) => {
  let editCount = 0;
  let deleteCount = 0;

  return {
    id,
    channelId,
    get editCount() {
      return editCount;
    },
    get deleteCount() {
      return deleteCount;
    },
    async edit(): Promise<void> {
      editCount += 1;
    },
    async delete(): Promise<void> {
      deleteCount += 1;
    },
  };
};

const createTextChannel = (
  id: string,
  fetchedMessage?: ReturnType<typeof createMessage>,
) => {
  const sentMessages: Array<ReturnType<typeof createMessage>> = [];

  return {
    id,
    sentMessages,
    isTextBased: () => true,
    messages: {
      fetch: async (messageId: string) => {
        if (!fetchedMessage || fetchedMessage.id !== messageId) {
          throw new Error('Unknown Message');
        }

        return fetchedMessage;
      },
    },
    send: async () => {
      const message = createMessage(`new-${sentMessages.length + 1}`, id);
      sentMessages.push(message);
      return message;
    },
  };
};

const createQueue = (
  textChannel: ReturnType<typeof createTextChannel>,
): GuildMusicSession =>
  ({
    guild: {
      id: RESTORABLE_MUSIC_PANEL_GUILD_ID,
      members: { me: { id: 'bot-user' } },
      client: { user: { id: 'bot-user' } },
    },
    metadata: {
      textChannel,
      requestedById: 'bot-user',
    },
    channel: { id: 'voice-1' },
    currentTrack: null,
    durationFormatted: '0:00',
    history: {
      isEmpty: () => true,
      tracks: { toArray: () => [] },
    },
    isShuffling: false,
    node: {
      volume: 70,
      isPaused: () => false,
    },
    repeatMode: QueueRepeatMode.OFF,
    size: 0,
    tracks: { toArray: () => [] },
  }) as GuildMusicSession;

describe('MusicPanelManager', () => {
  it('reuses a restored 24/7 panel message instead of sending a duplicate', async () => {
    const existingMessage = createMessage('panel-1', 'text-1');
    const textChannel = createTextChannel('text-1', existingMessage);
    const queueState = new MemoryQueueStateService([
      createState({
        panelMessage: {
          channelId: 'text-1',
          messageId: 'panel-1',
        },
      }),
    ]);
    const player = {
      client: {
        channels: {
          fetch: async () => textChannel,
        },
      },
    };
    const manager = new MusicPanelManager(player as never, logger, queueState);

    await manager.render(createQueue(textChannel));

    assert.equal(existingMessage.editCount, 1);
    assert.equal(textChannel.sentMessages.length, 0);
    assert.deepEqual(
      queueState.get(RESTORABLE_MUSIC_PANEL_GUILD_ID)?.panelMessage,
      {
        channelId: 'text-1',
        messageId: 'panel-1',
      },
    );
  });

  it('deletes an old restored panel before sending a replacement in the active channel', async () => {
    const oldMessage = createMessage('panel-old', 'text-old');
    const oldChannel = createTextChannel('text-old', oldMessage);
    const activeChannel = createTextChannel('text-new');
    const queueState = new MemoryQueueStateService([
      createState({
        textChannelId: 'text-new',
        panelMessage: {
          channelId: 'text-old',
          messageId: 'panel-old',
        },
      }),
    ]);
    const player = {
      client: {
        channels: {
          fetch: async (channelId: string) => {
            assert.equal(channelId, 'text-old');
            return oldChannel;
          },
        },
      },
    };
    const manager = new MusicPanelManager(player as never, logger, queueState);

    await manager.render(createQueue(activeChannel));

    assert.equal(oldMessage.deleteCount, 1);
    assert.equal(activeChannel.sentMessages.length, 1);
    assert.deepEqual(
      queueState.get(RESTORABLE_MUSIC_PANEL_GUILD_ID)?.panelMessage,
      {
        channelId: 'text-new',
        messageId: 'new-1',
      },
    );
  });
});

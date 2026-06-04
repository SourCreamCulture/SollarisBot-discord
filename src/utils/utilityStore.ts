import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';

import type { Logger } from './logger';

export const DEFAULT_UTILITY_STORE_FILE = 'data/utility-store.json';

export interface SavedReminder {
  id: string;
  guildId: string;
  channelId: string;
  userId: string;
  message: string;
  remindAt: string;
  createdAt: string;
}

export interface SavedEvent {
  id: string;
  guildId: string;
  channelId: string;
  messageId?: string;
  title: string;
  startsAt: string;
  createdById: string;
  createdAt: string;
  attendees: string[];
}

export interface SavedPoll {
  id: string;
  guildId: string;
  channelId: string;
  question: string;
  options: string[];
  votes: Record<string, number>;
  createdById: string;
  createdAt: string;
}

export interface UtilityStore {
  addReminder(
    reminder: Omit<SavedReminder, 'id' | 'createdAt'>,
  ): Promise<SavedReminder>;
  removeReminder(id: string): Promise<SavedReminder | null>;
  listReminders(userId: string): SavedReminder[];
  getDueReminders(now: Date): SavedReminder[];
  addEvent(
    event: Omit<SavedEvent, 'id' | 'createdAt' | 'attendees'>,
  ): Promise<SavedEvent>;
  setEventMessage(id: string, messageId: string): Promise<void>;
  getEvent(id: string): SavedEvent | null;
  toggleEventRsvp(id: string, userId: string): Promise<SavedEvent | null>;
  listEvents(guildId: string): SavedEvent[];
  addPoll(
    poll: Omit<SavedPoll, 'id' | 'createdAt' | 'votes'>,
  ): Promise<SavedPoll>;
  getPoll(id: string): SavedPoll | null;
  votePoll(
    id: string,
    userId: string,
    optionIndex: number,
  ): Promise<SavedPoll | null>;
}

const reminderSchema = z.object({
  id: z.string(),
  guildId: z.string(),
  channelId: z.string(),
  userId: z.string(),
  message: z.string(),
  remindAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});

const eventSchema = z.object({
  id: z.string(),
  guildId: z.string(),
  channelId: z.string(),
  messageId: z.string().optional(),
  title: z.string(),
  startsAt: z.string().datetime(),
  createdById: z.string(),
  createdAt: z.string().datetime(),
  attendees: z.array(z.string()),
});

const pollSchema = z.object({
  id: z.string(),
  guildId: z.string(),
  channelId: z.string(),
  question: z.string(),
  options: z.array(z.string()),
  votes: z.record(z.string(), z.number().int().min(0)),
  createdById: z.string(),
  createdAt: z.string().datetime(),
});

const fileSchema = z.object({
  version: z.literal(1),
  reminders: z.record(z.string(), reminderSchema),
  events: z.record(z.string(), eventSchema),
  polls: z.record(z.string(), pollSchema).default({}),
});

type StoredFile = z.infer<typeof fileSchema>;

const createEmptyFile = (): StoredFile => ({
  version: 1,
  reminders: {},
  events: {},
  polls: {},
});

const writeJsonAtomic = async (
  filePath: string,
  payload: StoredFile,
): Promise<void> => {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8',
  );
  await rename(temporaryPath, filePath);
};

const createId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;

const cloneReminder = (reminder: SavedReminder): SavedReminder => ({
  ...reminder,
});

const cloneEvent = (event: SavedEvent): SavedEvent => ({
  ...event,
  attendees: [...event.attendees],
});

const clonePoll = (poll: SavedPoll): SavedPoll => ({
  ...poll,
  options: [...poll.options],
  votes: { ...poll.votes },
});

class JsonUtilityStore implements UtilityStore {
  private data = createEmptyFile();
  private writeChain = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly logger: Logger,
  ) {}

  async initialize(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });

    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = fileSchema.safeParse(JSON.parse(raw) as unknown);

      if (!parsed.success) {
        throw new Error(
          `Utility store file is invalid: ${parsed.error.issues
            .map((issue) => issue.message)
            .join(', ')}`,
        );
      }

      this.data = parsed.data;
      this.logger.debug('Loaded utility store from disk.');
    } catch (error) {
      const isMissingFile =
        error instanceof Error && 'code' in error && error.code === 'ENOENT';

      if (!isMissingFile) {
        throw error;
      }

      this.data = createEmptyFile();
      await writeJsonAtomic(this.filePath, this.data);
      this.logger.info(`Created utility store at ${this.filePath}.`);
    }
  }

  async addReminder(
    reminder: Omit<SavedReminder, 'id' | 'createdAt'>,
  ): Promise<SavedReminder> {
    const saved: SavedReminder = {
      ...reminder,
      id: createId('reminder'),
      createdAt: new Date().toISOString(),
    };
    this.data.reminders[saved.id] = saved;
    await this.persist();
    return cloneReminder(saved);
  }

  async removeReminder(id: string): Promise<SavedReminder | null> {
    const reminder = this.data.reminders[id];

    if (!reminder) {
      return null;
    }

    delete this.data.reminders[id];
    await this.persist();
    return cloneReminder(reminder);
  }

  listReminders(userId: string): SavedReminder[] {
    return Object.values(this.data.reminders)
      .filter((reminder) => reminder.userId === userId)
      .sort((left, right) => left.remindAt.localeCompare(right.remindAt))
      .map(cloneReminder);
  }

  getDueReminders(now: Date): SavedReminder[] {
    const timestamp = now.toISOString();
    return Object.values(this.data.reminders)
      .filter((reminder) => reminder.remindAt <= timestamp)
      .map(cloneReminder);
  }

  async addEvent(
    event: Omit<SavedEvent, 'id' | 'createdAt' | 'attendees'>,
  ): Promise<SavedEvent> {
    const saved: SavedEvent = {
      ...event,
      id: createId('event'),
      createdAt: new Date().toISOString(),
      attendees: [],
    };
    this.data.events[saved.id] = saved;
    await this.persist();
    return cloneEvent(saved);
  }

  async setEventMessage(id: string, messageId: string): Promise<void> {
    const event = this.data.events[id];

    if (!event) {
      return;
    }

    event.messageId = messageId;
    await this.persist();
  }

  getEvent(id: string): SavedEvent | null {
    const event = this.data.events[id];
    return event ? cloneEvent(event) : null;
  }

  async toggleEventRsvp(
    id: string,
    userId: string,
  ): Promise<SavedEvent | null> {
    const event = this.data.events[id];

    if (!event) {
      return null;
    }

    if (event.attendees.includes(userId)) {
      event.attendees = event.attendees.filter(
        (attendee) => attendee !== userId,
      );
    } else {
      event.attendees.push(userId);
    }

    await this.persist();
    return cloneEvent(event);
  }

  listEvents(guildId: string): SavedEvent[] {
    return Object.values(this.data.events)
      .filter((event) => event.guildId === guildId)
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt))
      .map(cloneEvent);
  }

  async addPoll(
    poll: Omit<SavedPoll, 'id' | 'createdAt' | 'votes'>,
  ): Promise<SavedPoll> {
    const saved: SavedPoll = {
      ...poll,
      id: createId('poll'),
      createdAt: new Date().toISOString(),
      votes: {},
    };
    this.data.polls[saved.id] = saved;
    await this.persist();
    return clonePoll(saved);
  }

  getPoll(id: string): SavedPoll | null {
    const poll = this.data.polls[id];
    return poll ? clonePoll(poll) : null;
  }

  async votePoll(
    id: string,
    userId: string,
    optionIndex: number,
  ): Promise<SavedPoll | null> {
    const poll = this.data.polls[id];

    if (!poll || !poll.options[optionIndex]) {
      return null;
    }

    poll.votes[userId] = optionIndex;
    await this.persist();
    return clonePoll(poll);
  }

  private async persist(): Promise<void> {
    const snapshot: StoredFile = {
      version: 1,
      reminders: Object.fromEntries(
        Object.entries(this.data.reminders).map(([id, reminder]) => [
          id,
          cloneReminder(reminder),
        ]),
      ),
      events: Object.fromEntries(
        Object.entries(this.data.events).map(([id, event]) => [
          id,
          cloneEvent(event),
        ]),
      ),
      polls: Object.fromEntries(
        Object.entries(this.data.polls).map(([id, poll]) => [
          id,
          clonePoll(poll),
        ]),
      ),
    };

    this.writeChain = this.writeChain.then(() =>
      writeJsonAtomic(this.filePath, snapshot),
    );

    await this.writeChain;
  }
}

export const createJsonUtilityStore = async (
  filePath: string,
  logger: Logger,
): Promise<UtilityStore> => {
  const store = new JsonUtilityStore(filePath, logger);
  await store.initialize();
  return store;
};

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';
import { UserFacingError } from './errors';

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
  attempts?: number;
  nextAttemptAt?: string;
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
  capacity?: number | null;
  reminderMinutes?: number;
  cancelled?: boolean;
  remindedUserIds?: string[];
  nextReminderAttemptAt?: string;
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

export const settingTargets = [
  'apex',
  'valorant',
  'lfg',
  'event',
  'poll',
  'remind',
  'roll',
] as const;
export type SettingTarget = (typeof settingTargets)[number];
export interface GuildSettings {
  guildId: string;
  timezone: string;
  eventReminderMinutes: number;
  lfgExpiryMinutes: number;
  leaderboardChannelId: string | null;
  leaderboardRefreshMinutes: number;
  commandChannels: Partial<Record<SettingTarget, string>>;
  commandRoles: Partial<Record<SettingTarget, string>>;
}
export interface SavedLfg {
  id: string;
  guildId: string;
  channelId: string;
  messageId?: string;
  game: 'apex' | 'valorant';
  createdById: string;
  description: string;
  capacity: number;
  participants: string[];
  expiresAt: string;
  closed: boolean;
  expiryRendered: boolean;
}
export interface UtilityStore {
  getGuildSettings(guildId: string): GuildSettings;
  getAllGuildSettings(): GuildSettings[];
  updateGuildSettings(
    guildId: string,
    patch: Partial<Omit<GuildSettings, 'guildId'>>,
  ): Promise<GuildSettings>;
  getReminder(id: string): SavedReminder | null;
  retryReminder(id: string, now: Date): Promise<void>;
  updateEvent(
    id: string,
    patch: Partial<
      Pick<
        SavedEvent,
        'title' | 'startsAt' | 'capacity' | 'reminderMinutes' | 'cancelled'
      >
    >,
  ): Promise<SavedEvent | null>;
  getDueEvents(now: Date): SavedEvent[];
  markEventReminded(
    id: string,
    userIds: string[],
    startsAt?: string,
  ): Promise<void>;
  retryEventReminder(id: string, now: Date): Promise<void>;
  addLfg(
    input: Omit<SavedLfg, 'id' | 'participants' | 'closed' | 'expiryRendered'>,
  ): Promise<SavedLfg>;
  getLfg(id: string): SavedLfg | null;
  setLfgMessage(id: string, messageId: string): Promise<void>;
  updateLfgParticipant(
    id: string,
    userId: string,
    action: 'join' | 'leave' | 'close',
  ): Promise<SavedLfg | null>;
  getExpiredLfgs(now: Date): SavedLfg[];
  markLfgExpiryRendered(id: string): Promise<void>;
  addReminder(
    reminder: Omit<SavedReminder, 'id' | 'createdAt'>,
  ): Promise<SavedReminder>;
  removeReminder(id: string): Promise<SavedReminder | null>;
  listReminders(userId: string, guildId?: string): SavedReminder[];
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
  attempts: z.number().int().min(0).default(0),
  nextAttemptAt: z.string().datetime().optional(),
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
  capacity: z.number().int().min(1).max(100).nullable().default(null),
  reminderMinutes: z.number().int().min(0).max(10080).default(15),
  cancelled: z.boolean().default(false),
  remindedUserIds: z.array(z.string()).default([]),
  nextReminderAttemptAt: z.string().datetime().optional(),
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

const guildSettingsSchema = z.object({
  guildId: z.string(),
  timezone: z.string().default('UTC'),
  eventReminderMinutes: z.number().int().min(0).max(10080).default(15),
  lfgExpiryMinutes: z.number().int().min(1).max(1440).default(60),
  leaderboardChannelId: z.string().nullable().default(null),
  leaderboardRefreshMinutes: z.number().int().min(1).max(1440).default(10),
  commandChannels: z
    .partialRecord(z.enum(settingTargets), z.string())
    .default({}),
  commandRoles: z.partialRecord(z.enum(settingTargets), z.string()).default({}),
});
const lfgSchema = z.object({
  id: z.string(),
  guildId: z.string(),
  channelId: z.string(),
  messageId: z.string().optional(),
  game: z.enum(['apex', 'valorant']),
  createdById: z.string(),
  description: z.string(),
  capacity: z.number().int().min(2).max(10),
  participants: z.array(z.string()),
  expiresAt: z.string().datetime(),
  closed: z.boolean(),
  expiryRendered: z.boolean(),
});
const fileSchema = z.object({
  version: z.literal(1),
  reminders: z.record(z.string(), reminderSchema),
  events: z.record(z.string(), eventSchema),
  polls: z.record(z.string(), pollSchema).default({}),
  guilds: z.record(z.string(), guildSettingsSchema).default({}),
  lfgs: z.record(z.string(), lfgSchema).default({}),
});

type StoredFile = z.infer<typeof fileSchema>;

const createEmptyFile = (): StoredFile => ({
  version: 1,
  reminders: {},
  events: {},
  polls: {},
  guilds: {},
  lfgs: {},
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
  remindedUserIds: [...(event.remindedUserIds ?? [])],
});

const clonePoll = (poll: SavedPoll): SavedPoll => ({
  ...poll,
  options: [...poll.options],
  votes: { ...poll.votes },
});

const cloneGuildSettings = (settings: GuildSettings): GuildSettings => ({
  ...settings,
  commandChannels: { ...settings.commandChannels },
  commandRoles: { ...settings.commandRoles },
});
const cloneLfg = (lfg: SavedLfg): SavedLfg => ({
  ...lfg,
  participants: [...lfg.participants],
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
    this.data.reminders[saved.id] = reminderSchema.parse(saved);
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

  listReminders(userId: string, guildId?: string): SavedReminder[] {
    return Object.values(this.data.reminders)
      .filter(
        (reminder) =>
          reminder.userId === userId &&
          (!guildId || reminder.guildId === guildId),
      )
      .sort((left, right) => left.remindAt.localeCompare(right.remindAt))
      .map(cloneReminder);
  }

  getDueReminders(now: Date): SavedReminder[] {
    const timestamp = now.toISOString();
    return Object.values(this.data.reminders)
      .filter(
        (reminder) =>
          reminder.remindAt <= timestamp &&
          (!reminder.nextAttemptAt || reminder.nextAttemptAt <= timestamp),
      )
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
      capacity: event.capacity ?? null,
      reminderMinutes: event.reminderMinutes ?? 15,
      cancelled: false,
      remindedUserIds: [],
    };
    this.data.events[saved.id] = eventSchema.parse(saved);
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

    if (
      !event ||
      event.cancelled ||
      new Date(event.startsAt).getTime() <= Date.now()
    ) {
      return null;
    }

    if (event.attendees.includes(userId)) {
      event.attendees = event.attendees.filter(
        (attendee) => attendee !== userId,
      );
    } else {
      if (event.capacity && event.attendees.length >= event.capacity) {
        throw new UserFacingError('This event is full.');
      }
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

  getGuildSettings(guildId: string): GuildSettings {
    return cloneGuildSettings(
      this.data.guilds[guildId] ?? guildSettingsSchema.parse({ guildId }),
    );
  }
  getAllGuildSettings(): GuildSettings[] {
    return Object.values(this.data.guilds).map(cloneGuildSettings);
  }
  async updateGuildSettings(
    guildId: string,
    patch: Partial<Omit<GuildSettings, 'guildId'>>,
  ): Promise<GuildSettings> {
    const next = guildSettingsSchema.parse({
      ...this.getGuildSettings(guildId),
      ...patch,
      guildId,
    });
    this.data.guilds[guildId] = next;
    await this.persist();
    return this.getGuildSettings(guildId);
  }
  getReminder(id: string): SavedReminder | null {
    return this.data.reminders[id]
      ? cloneReminder(this.data.reminders[id])
      : null;
  }
  async retryReminder(id: string, now: Date): Promise<void> {
    const reminder = this.data.reminders[id];
    if (!reminder) return;
    reminder.attempts = (reminder.attempts ?? 0) + 1;
    reminder.nextAttemptAt = new Date(
      now.getTime() +
        Math.min(3600000, 30000 * 2 ** Math.min(reminder.attempts, 7)),
    ).toISOString();
    await this.persist();
  }
  async updateEvent(
    id: string,
    patch: Partial<
      Pick<
        SavedEvent,
        'title' | 'startsAt' | 'capacity' | 'reminderMinutes' | 'cancelled'
      >
    >,
  ): Promise<SavedEvent | null> {
    const event = this.data.events[id];
    if (!event) return null;
    if (patch.capacity && patch.capacity < event.attendees.length)
      throw new UserFacingError(
        'The player limit cannot be smaller than the current RSVP count.',
      );
    if (patch.startsAt && patch.startsAt !== event.startsAt) {
      event.remindedUserIds = [];
      event.nextReminderAttemptAt = undefined;
    }
    this.data.events[id] = eventSchema.parse({ ...event, ...patch });
    await this.persist();
    return this.getEvent(id);
  }
  getDueEvents(now: Date): SavedEvent[] {
    return Object.values(this.data.events)
      .filter(
        (event) =>
          !event.cancelled &&
          event.reminderMinutes > 0 &&
          Date.parse(event.startsAt) > now.getTime() &&
          Date.parse(event.startsAt) - event.reminderMinutes * 60000 <=
            now.getTime() &&
          (!event.nextReminderAttemptAt ||
            Date.parse(event.nextReminderAttemptAt) <= now.getTime()) &&
          event.attendees.some((id) => !event.remindedUserIds.includes(id)),
      )
      .map(cloneEvent);
  }
  async markEventReminded(
    id: string,
    userIds: string[],
    startsAt?: string,
  ): Promise<void> {
    const event = this.data.events[id];
    if (!event || event.cancelled || (startsAt && event.startsAt !== startsAt))
      return;
    event.remindedUserIds = [
      ...new Set([...event.remindedUserIds, ...userIds]),
    ];
    event.nextReminderAttemptAt = undefined;
    await this.persist();
  }
  async retryEventReminder(id: string, now: Date): Promise<void> {
    const event = this.data.events[id];
    if (!event) return;
    event.nextReminderAttemptAt = new Date(now.getTime() + 60000).toISOString();
    await this.persist();
  }
  async addLfg(
    input: Omit<SavedLfg, 'id' | 'participants' | 'closed' | 'expiryRendered'>,
  ): Promise<SavedLfg> {
    const lfg = lfgSchema.parse({
      ...input,
      id: createId('lfg'),
      participants: [input.createdById],
      closed: false,
      expiryRendered: false,
    });
    this.data.lfgs[lfg.id] = lfg;
    await this.persist();
    return cloneLfg(lfg);
  }
  getLfg(id: string): SavedLfg | null {
    return this.data.lfgs[id] ? cloneLfg(this.data.lfgs[id]) : null;
  }
  async setLfgMessage(id: string, messageId: string): Promise<void> {
    const lfg = this.data.lfgs[id];
    if (!lfg) return;
    lfg.messageId = messageId;
    await this.persist();
  }
  async updateLfgParticipant(
    id: string,
    userId: string,
    action: 'join' | 'leave' | 'close',
  ): Promise<SavedLfg | null> {
    const lfg = this.data.lfgs[id];
    if (!lfg || lfg.closed || Date.parse(lfg.expiresAt) <= Date.now())
      return null;
    if (action === 'close') {
      if (lfg.createdById !== userId)
        throw new UserFacingError('Only the host can close this LFG post.');
      lfg.closed = true;
    } else if (action === 'leave') {
      if (lfg.createdById === userId)
        throw new UserFacingError(
          'The host can close the post instead of leaving.',
        );
      lfg.participants = lfg.participants.filter((id) => id !== userId);
    } else if (!lfg.participants.includes(userId)) {
      if (lfg.participants.length >= lfg.capacity)
        throw new UserFacingError('This squad is full.');
      lfg.participants.push(userId);
    }
    await this.persist();
    return cloneLfg(lfg);
  }
  getExpiredLfgs(now: Date): SavedLfg[] {
    return Object.values(this.data.lfgs)
      .filter(
        (lfg) =>
          !lfg.expiryRendered &&
          (lfg.closed || Date.parse(lfg.expiresAt) <= now.getTime()),
      )
      .map((lfg) => cloneLfg(lfg));
  }
  async markLfgExpiryRendered(id: string): Promise<void> {
    const lfg = this.data.lfgs[id];
    if (!lfg) return;
    lfg.expiryRendered = true;
    await this.persist();
  }

  private async persist(): Promise<void> {
    const snapshot: StoredFile = {
      version: 1,
      guilds: Object.fromEntries(
        Object.entries(this.data.guilds).map(([id, settings]) => [
          id,
          cloneGuildSettings(settings),
        ]),
      ),
      lfgs: Object.fromEntries(
        Object.entries(this.data.lfgs).map(([id, lfg]) => [id, cloneLfg(lfg)]),
      ),
      reminders: Object.fromEntries(
        Object.entries(this.data.reminders).map(([id, reminder]) => [
          id,
          reminderSchema.parse(reminder),
        ]),
      ),
      events: Object.fromEntries(
        Object.entries(this.data.events).map(([id, event]) => [
          id,
          eventSchema.parse(event),
        ]),
      ),
      polls: Object.fromEntries(
        Object.entries(this.data.polls).map(([id, poll]) => [
          id,
          clonePoll(poll),
        ]),
      ),
    };

    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(() => writeJsonAtomic(this.filePath, snapshot));

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

export const isTimezone = (timezone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
};

const localParts = (date: Date, timezone: string): number[] => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return ['year', 'month', 'day', 'hour', 'minute', 'second'].map((type) =>
    Number(parts.find((p) => p.type === type)?.value),
  );
};

/** Reject ambiguous/nonexistent DST wall times; an explicit ISO offset resolves ambiguity. */
export const parseScheduledTime = (
  input: string,
  timezone: string,
  now = new Date(),
): Date | null => {
  if (!isTimezone(timezone)) return null;
  const value = input.trim();
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?$/i.exec(
      value,
    );
  if (!match) return null;
  const numbers = match.slice(1, 7).map((v) => Number(v ?? 0));
  const [year, month, day, hour, minute, second] = numbers;
  const wall = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    wall.getUTCFullYear() !== year ||
    wall.getUTCMonth() !== month - 1 ||
    wall.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return null;
  if (match[7]) {
    const date = new Date(
      `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] ?? '00'}${match[7].toUpperCase()}`,
    );
    return Number.isFinite(date.getTime()) && date > now ? date : null;
  }
  const candidates = new Set<number>();
  for (let offset = -36; offset <= 36; offset += 6) {
    const sample = new Date(wall.getTime() + offset * 3600000);
    const [y, m, d, h, min, sec] = localParts(sample, timezone);
    const zoneOffset = Date.UTC(y, m - 1, d, h, min, sec) - sample.getTime();
    const candidate = wall.getTime() - zoneOffset;
    if (
      localParts(new Date(candidate), timezone).every(
        (part, index) => part === numbers[index],
      )
    )
      candidates.add(candidate);
  }
  if (candidates.size !== 1) return null;
  const date = new Date([...candidates][0]);
  return date > now ? date : null;
};

export const parseReminderTime = (
  input: string,
  timezone: string,
  now = new Date(),
): Date | null => {
  if (!isTimezone(timezone)) return null;
  const value = input.trim();
  if (/^tomorrow$/i.test(value)) {
    const [year, month, day] = localParts(now, timezone);
    const tomorrow = new Date(Date.UTC(year, month - 1, day + 1));
    return parseScheduledTime(
      `${tomorrow.toISOString().slice(0, 10)} 09:00`,
      timezone,
      now,
    );
  }
  if (
    /^(?:\d+\s*(?:days?|d|hours?|hr|h|minutes?|min|m|seconds?|sec|s)\s*)+$/i.test(
      value,
    )
  ) {
    let total = 0;
    for (const match of value.matchAll(
      /(\d+)\s*(days?|d|hours?|hr|h|minutes?|min|m|seconds?|sec|s)/gi,
    )) {
      const unit = match[2][0].toLowerCase();
      total +=
        Number(match[1]) *
        ({ d: 86400000, h: 3600000, m: 60000, s: 1000 }[unit] ?? 0);
    }
    const date = new Date(now.getTime() + total);
    return total > 0 && Number.isFinite(date.getTime()) ? date : null;
  }
  return parseScheduledTime(value, timezone, now);
};

const unitPattern =
  /(\d+)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)/gi;

export const parseSeekTime = (input: string): number | null => {
  const value = input.trim().toLowerCase();

  if (!value) {
    return null;
  }

  if (/^\d+$/.test(value)) {
    return Number(value) * 1000;
  }

  if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(value)) {
    const parts = value.split(':').map(Number);
    const seconds =
      parts.length === 3
        ? parts[0] * 3600 + parts[1] * 60 + parts[2]
        : parts[0] * 60 + parts[1];

    return seconds * 1000;
  }

  let totalSeconds = 0;
  let matched = false;

  for (const match of value.matchAll(unitPattern)) {
    matched = true;
    const amount = Number(match[1]);
    const unit = match[2][0];

    if (unit === 'h') {
      totalSeconds += amount * 3600;
    } else if (unit === 'm') {
      totalSeconds += amount * 60;
    } else {
      totalSeconds += amount;
    }
  }

  return matched ? totalSeconds * 1000 : null;
};

export const formatDuration = (milliseconds: number): string => {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

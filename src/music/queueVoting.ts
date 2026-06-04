export type QueueVoteDirection = 'up' | 'down';

interface TrackVotes {
  up: Set<string>;
  down: Set<string>;
}

export interface QueueVoteResult {
  score: number;
  moved: 'up' | 'down' | null;
}

export class QueueVoteManager {
  private readonly votes = new Map<string, Map<string, TrackVotes>>();

  vote(
    guildId: string,
    trackUrl: string,
    userId: string,
    direction: QueueVoteDirection,
  ): QueueVoteResult {
    const guildVotes = this.getGuildVotes(guildId);
    const trackVotes = guildVotes.get(trackUrl) ?? {
      up: new Set<string>(),
      down: new Set<string>(),
    };

    trackVotes.up.delete(userId);
    trackVotes.down.delete(userId);
    trackVotes[direction].add(userId);
    guildVotes.set(trackUrl, trackVotes);

    const score = trackVotes.up.size - trackVotes.down.size;
    const moved = score >= 2 ? 'up' : score <= -2 ? 'down' : null;

    if (moved) {
      guildVotes.delete(trackUrl);
    }

    return { score, moved };
  }

  clearGuild(guildId: string): void {
    this.votes.delete(guildId);
  }

  private getGuildVotes(guildId: string): Map<string, TrackVotes> {
    const existing = this.votes.get(guildId);

    if (existing) {
      return existing;
    }

    const created = new Map<string, TrackVotes>();
    this.votes.set(guildId, created);
    return created;
  }
}

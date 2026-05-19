import type { Track } from 'discord-player';

export interface VoteSkipResult {
  votes: number;
  requiredVotes: number;
  alreadyVoted: boolean;
  passed: boolean;
}

interface VoteState {
  trackId: string;
  voters: Set<string>;
}

export class VoteSkipManager {
  private readonly votesByGuild = new Map<string, VoteState>();

  registerVote(input: {
    guildId: string;
    track: Track;
    voterId: string;
    eligibleVoters: number;
    threshold: number;
  }): VoteSkipResult {
    const state = this.getState(input.guildId, input.track.id);
    const alreadyVoted = state.voters.has(input.voterId);

    state.voters.add(input.voterId);

    const requiredVotes = Math.max(
      1,
      Math.ceil(input.eligibleVoters * input.threshold),
    );
    const votes = state.voters.size;

    return {
      votes,
      requiredVotes,
      alreadyVoted,
      passed: votes >= requiredVotes,
    };
  }

  clearGuild(guildId: string): void {
    this.votesByGuild.delete(guildId);
  }

  private getState(guildId: string, trackId: string): VoteState {
    const existing = this.votesByGuild.get(guildId);

    if (existing?.trackId === trackId) {
      return existing;
    }

    const state: VoteState = {
      trackId,
      voters: new Set(),
    };

    this.votesByGuild.set(guildId, state);
    return state;
  }
}

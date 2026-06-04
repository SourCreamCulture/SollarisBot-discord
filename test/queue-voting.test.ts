import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { QueueVoteManager } from '../src/music/queueVoting';

describe('QueueVoteManager', () => {
  it('lets users switch votes and signals movement at a score of two', () => {
    const manager = new QueueVoteManager();

    assert.deepEqual(manager.vote('guild-1', 'track-1', 'user-1', 'up'), {
      score: 1,
      moved: null,
    });
    assert.deepEqual(manager.vote('guild-1', 'track-1', 'user-1', 'down'), {
      score: -1,
      moved: null,
    });
    assert.deepEqual(manager.vote('guild-1', 'track-1', 'user-2', 'down'), {
      score: -2,
      moved: 'down',
    });
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertSupportedApexPlatform,
  getPlatformLabel,
  toMozambiquePlatform,
  toProviderPlatform,
} from '../src/apex/platform';

describe('apex platform mapping', () => {
  it('supports PC, PlayStation, and Xbox across providers', () => {
    assert.equal(assertSupportedApexPlatform('pc'), 'pc');
    assert.equal(assertSupportedApexPlatform('playstation'), 'playstation');
    assert.equal(assertSupportedApexPlatform('xbox'), 'xbox');

    assert.equal(toProviderPlatform('pc'), 'origin');
    assert.equal(toProviderPlatform('playstation'), 'psn');
    assert.equal(toProviderPlatform('xbox'), 'xbl');

    assert.equal(toMozambiquePlatform('pc'), 'PC');
    assert.equal(toMozambiquePlatform('playstation'), 'PS4');
    assert.equal(toMozambiquePlatform('xbox'), 'X1');

    assert.equal(getPlatformLabel('pc'), 'PC');
    assert.equal(getPlatformLabel('playstation'), 'PlayStation');
    assert.equal(getPlatformLabel('xbox'), 'Xbox');
  });
});

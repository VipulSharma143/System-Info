import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BEHAVIOR_OPTIONS, isBehavior, needsTray, parseBehaviorState } from '../src/lib/behavior.ts';

describe('startup behaviour', () => {
  it('offers exactly the three choices, each with a description', () => {
    assert.deepEqual(BEHAVIOR_OPTIONS.map((o) => o.value), ['background', 'off', 'startup']);
    for (const o of BEHAVIOR_OPTIONS) assert.ok(o.label.length > 0 && o.detail.length > 0);
  });

  it('accepts only known values', () => {
    assert.ok(isBehavior('startup'));
    assert.ok(!isBehavior('always'));
    assert.ok(!isBehavior(null));
  });

  it('parses the shell reply and rejects anything else', () => {
    assert.deepEqual(parseBehaviorState({ behavior: 'background', firstRun: true, trayAvailable: false }), { behavior: 'background', firstRun: true, trayAvailable: false });
    assert.deepEqual(parseBehaviorState({ behavior: 'off' }), { behavior: 'off', firstRun: false, trayAvailable: true });
    assert.equal(parseBehaviorState({ behavior: 'nope' }), null);
    assert.equal(parseBehaviorState('off'), null);
    assert.equal(parseBehaviorState(null), null);
  });

  it('needs the tray only for the two background modes', () => {
    assert.ok(needsTray('background'));
    assert.ok(needsTray('startup'));
    assert.ok(!needsTray('off'));
  });
});

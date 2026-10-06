import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { scheduleWhenVisible } from '../src/lib/visibility.ts';

function fakeDoc(hidden: boolean) {
  const listeners = new Set<() => void>();
  return {
    hidden,
    addEventListener: (_: string, l: () => void) => void listeners.add(l),
    removeEventListener: (_: string, l: () => void) => void listeners.delete(l),
    listenerCount: () => listeners.size,
    show() { this.hidden = false; for (const l of [...listeners]) l(); },
  };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('scheduleWhenVisible', () => {
  it('runs after the delay while visible', async () => {
    const doc = fakeDoc(false); let ran = 0;
    scheduleWhenVisible(() => { ran += 1; }, 10, doc as never);
    await wait(40);
    assert.equal(ran, 1);
  });
  it('does not run while hidden, and runs once as soon as it becomes visible', async () => {
    const doc = fakeDoc(true); let ran = 0;
    scheduleWhenVisible(() => { ran += 1; }, 10, doc as never);
    await wait(40);
    assert.equal(ran, 0);
    assert.equal(doc.listenerCount(), 1);
    doc.show();
    assert.equal(ran, 1);
    assert.equal(doc.listenerCount(), 0, 'the listener is removed after firing');
  });
  it('cancel stops the timer and removes the listener', async () => {
    const doc = fakeDoc(true); let ran = 0;
    const cancel = scheduleWhenVisible(() => { ran += 1; }, 10, doc as never);
    await wait(40);
    cancel();
    assert.equal(doc.listenerCount(), 0);
    doc.show();
    assert.equal(ran, 0);
    const doc2 = fakeDoc(false);
    scheduleWhenVisible(() => { ran += 1; }, 10, doc2 as never)();
    await wait(40);
    assert.equal(ran, 0, 'cancelling before the delay ends prevents the run');
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  backoffMs, classifyUpdateError, describeError, downloadComplete, prepareForInstall, retryTransient, type PrepareResult,
} from '../src/lib/updateFlow.ts';

const noSleep = async () => undefined;

describe('classifyUpdateError', () => {
  it('treats network blips as transient', () => {
    for (const m of ['error sending request for url (https://github.com/x)', 'operation timed out', 'Connection reset by peer', 'dns error: failed to lookup address', 'request failed with status code 503'])
      assert.equal(classifyUpdateError(new Error(m)), 'transient', m);
  });
  it('treats a file the OS has not released as transient', () => {
    for (const m of ['The process cannot access the file because it is being used by another process. (os error 32)', 'Text file busy', 'EBUSY: resource busy', 'files are still locked'])
      assert.equal(classifyUpdateError(new Error(m)), 'transient', m);
  });
  it('never retries permanent failures', () => {
    for (const m of ['signature verification failed', 'request failed with status code 404', 'No space left on device (os error 28)', 'Permission denied (os error 13)', 'Access is denied. (os error 5)', 'something nobody has seen before'])
      assert.equal(classifyUpdateError(new Error(m)), 'permanent', m);
  });
  it('recognises the user cancelling the password prompt', () => {
    assert.equal(classifyUpdateError(new Error('Request dismissed')), 'cancelled');
    assert.equal(classifyUpdateError(new Error('pkexec exited with code 126')), 'cancelled');
  });
  it('a bad signature beats a transient-sounding word', () => {
    assert.equal(classifyUpdateError(new Error('network download ok but signature verification failed')), 'permanent');
  });
  it('reads the cause chain', () => {
    const err = new Error('update failed', { cause: new Error('connection reset') });
    assert.equal(classifyUpdateError(err), 'transient');
    assert.match(describeError(err), /update failed \| caused by: connection reset/);
  });
  it('accepts non-Error values (the Tauri bridge rejects with strings)', () => {
    assert.equal(classifyUpdateError('error sending request'), 'transient');
    assert.equal(describeError(undefined), 'unknown error');
  });
});

describe('backoffMs', () => {
  it('doubles up to the cap with bounded jitter', () => {
    assert.equal(backoffMs(1, 1000, 8000, () => 0.5), 1000);
    assert.equal(backoffMs(2, 1000, 8000, () => 0.5), 2000);
    assert.equal(backoffMs(4, 1000, 8000, () => 0.5), 8000);
    assert.equal(backoffMs(9, 1000, 8000, () => 0.5), 8000);
    assert.equal(backoffMs(1, 1000, 8000, () => 0), 750);
    assert.equal(backoffMs(1, 1000, 8000, () => 1), 1250);
  });
});

describe('retryTransient', () => {
  it('returns at once on success without sleeping', async () => {
    let sleeps = 0;
    const out = await retryTransient(async () => 'ok', { retries: 3, sleep: async () => { sleeps += 1; } });
    assert.equal(out, 'ok');
    assert.equal(sleeps, 0);
  });
  it('retries a transient failure and then succeeds', async () => {
    let calls = 0; const delays: number[] = [];
    const out = await retryTransient(async () => { calls += 1; if (calls < 3) throw new Error('error sending request'); return 'done'; },
      { retries: 3, sleep: async (ms) => { delays.push(ms); }, random: () => 0.5 });
    assert.equal(out, 'done'); assert.equal(calls, 3); assert.deepEqual(delays, [1000, 2000]);
  });
  it('stops after the retry budget', async () => {
    let calls = 0;
    await assert.rejects(retryTransient(async () => { calls += 1; throw new Error('connection reset'); }, { retries: 2, sleep: noSleep }), /connection reset/);
    assert.equal(calls, 3);
  });
  it('does not retry a permanent failure', async () => {
    let calls = 0;
    await assert.rejects(retryTransient(async () => { calls += 1; throw new Error('signature verification failed'); }, { retries: 5, sleep: noSleep }));
    assert.equal(calls, 1);
  });
  it('does not retry a cancellation', async () => {
    let calls = 0;
    await assert.rejects(retryTransient(async () => { calls += 1; throw new Error('Request dismissed'); }, { retries: 5, sleep: noSleep }));
    assert.equal(calls, 1);
  });
  it('reports each retry', async () => {
    const seen: number[] = []; let calls = 0;
    await retryTransient(async () => { calls += 1; if (calls === 1) throw new Error('timed out'); }, { retries: 2, sleep: noSleep, onRetry: (n) => seen.push(n) });
    assert.deepEqual(seen, [1]);
  });
});

describe('downloadComplete', () => {
  it('rejects a short read, accepts the announced size', () => {
    assert.equal(downloadComplete(100, 100), true);
    assert.equal(downloadComplete(99, 100), false);
    assert.equal(downloadComplete(0, 100), false);
  });
  it('leaves an over-long body to the signature check instead of blocking the update', () => {
    assert.equal(downloadComplete(101, 100), true);
  });
  it('accepts any non-empty body when the size is unknown, never an empty one', () => {
    assert.equal(downloadComplete(5, null), true);
    assert.equal(downloadComplete(0, null), false);
  });
});

describe('prepareForInstall', () => {
  const result = (released: boolean, detail = ''): PrepareResult => ({ released, waitedMs: 1, detail });
  it('proceeds on the first confirmation', async () => {
    let calls = 0;
    const r = await prepareForInstall(async () => { calls += 1; return result(true); });
    assert.equal(r.released, true); assert.equal(calls, 1);
  });
  it('repeats the bounded wait while files stay held, then succeeds', async () => {
    const answers = [result(false, 'a.dll is still locked'), result(true)];
    const r = await prepareForInstall(async () => answers.shift()!);
    assert.equal(r.released, true);
  });
  it('reports unreleased instead of pretending it is safe', async () => {
    let calls = 0;
    const r = await prepareForInstall(async () => { calls += 1; return result(false, 'a.dll is still locked'); }, { retries: 2 });
    assert.equal(r.released, false); assert.equal(calls, 3); assert.match(r.detail, /a\.dll/);
  });
});

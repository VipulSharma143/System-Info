import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeWatching, formatDuration, formatWhen, newestFirst, percentChange, ratePerHour, sessionNotes, STALE_AFTER_MS, summarize } from '../src/components/views/battery/historyModel.ts';
import type { BatterySession, BatteryWatching } from '../src/types/batteryHistory.ts';

const HOUR = 3600;
const session = (over: Partial<BatterySession> = {}): BatterySession => ({
  kind: 'discharge', startUtc: '2026-10-11T08:00:00Z', endUtc: '2026-10-11T10:00:00Z', startPercent: 80, endPercent: 60,
  durationSec: 2 * HOUR, gapSec: 0, startExact: true, endExact: true, reachedFull: false, open: false, ...over,
});

describe('percentChange / ratePerHour', () => {
  it('is the gain or loss in percentage points', () => {
    assert.equal(percentChange(session()), -20);
    assert.equal(percentChange(session({ kind: 'charge', startPercent: 30, endPercent: 90 })), 60);
  });
  it('is unknown when either end is unknown', () => {
    assert.equal(percentChange(session({ startPercent: null })), null);
    assert.equal(ratePerHour(session({ endPercent: null })), null);
  });
  it('gives a positive per-hour rate for a clean stretch', () => {
    assert.equal(ratePerHour(session()), 10);                                                       // 20 points over 2 h
    assert.equal(ratePerHour(session({ kind: 'charge', startPercent: 20, endPercent: 80, durationSec: HOUR })), 60);
  });
  it('refuses a rate when the stretch has a gap, is too short, or moved the wrong way', () => {
    assert.equal(ratePerHour(session({ gapSec: 600 })), null);
    assert.equal(ratePerHour(session({ durationSec: 300 })), null);
    assert.equal(ratePerHour(session({ startPercent: 50, endPercent: 60 })), null);                  // "discharge" that went up
    assert.equal(ratePerHour(session({ kind: 'charge', startPercent: 90, endPercent: 80 })), null);  // "charge" that went down
  });
});

describe('formatDuration', () => {
  it('reads naturally at every scale', () => {
    assert.equal(formatDuration(0), '0 s');
    assert.equal(formatDuration(45), '45 s');
    assert.equal(formatDuration(12 * 60), '12 min');
    assert.equal(formatDuration(HOUR), '1 h');
    assert.equal(formatDuration(2 * HOUR + 5 * 60), '2 h 05 min');
    assert.equal(formatDuration(26 * HOUR), '1 d 2 h');
    assert.equal(formatDuration(48 * HOUR), '2 d');
    assert.equal(formatDuration(-5), '0 s');
  });
});

describe('summarize', () => {
  it('counts plug-ins and adds up only real gains', () => {
    const s = summarize([
      session({ kind: 'charge', startPercent: 20, endPercent: 100 }),
      session({ kind: 'charge', startPercent: 50, endPercent: 70 }),
      session({ kind: 'charge', startPercent: 90, endPercent: 80 }),   // a drop during a "charge" is not a gain
      session({ kind: 'charge', startPercent: null, endPercent: 60 }), // unknown start adds nothing
    ]);
    assert.equal(s.plugIns, 4);
    assert.equal(s.chargedPoints, 100);
  });
  it('finds the longest stretch on battery', () => {
    const s = summarize([session({ durationSec: HOUR }), session({ durationSec: 5 * HOUR }), session({ kind: 'charge', durationSec: 99 * HOUR })]);
    assert.equal(s.longestOnBatterySec, 5 * HOUR);
  });
  it('estimates a full battery only from measured drain, and says nothing otherwise', () => {
    const measured = summarize([session(), session({ startPercent: 100, endPercent: 80, durationSec: 2 * HOUR })]);   // 40 points / 4 h
    assert.equal(measured.averageDrainPerHour, 10);
    assert.equal(measured.fullBatteryHours, 10);

    const none = summarize([session({ gapSec: 3600 }), session({ durationSec: 120 }), session({ kind: 'charge' })]);
    assert.equal(none.averageDrainPerHour, null);
    assert.equal(none.fullBatteryHours, null);
    assert.equal(summarize([]).plugIns, 0);
    assert.equal(summarize([]).longestOnBatterySec, null);
  });
});

describe('sessionNotes', () => {
  it('says nothing about a clean, finished session', () => assert.deepEqual(sessionNotes(session()), []));
  it('explains every way a session is not fully known', () => {
    const notes = sessionNotes(session({ open: true, startExact: false, endExact: false, gapSec: 2 * HOUR, reachedFull: true }));
    assert.ok(notes.includes('In progress'));
    assert.ok(notes.some((n) => n.startsWith('Start time is approximate')));
    assert.ok(!notes.some((n) => n.startsWith('Ended while')), 'an open session has not ended');
    assert.ok(notes.some((n) => n.includes('2 h') && n.includes('not running')));
    assert.ok(notes.includes('Reached full'));
    assert.ok(sessionNotes(session({ endExact: false })).includes('Ended while System Info was not running'));
  });
});

describe('formatWhen / newestFirst', () => {
  it('formats in a given zone and survives a bad date', () => {
    assert.match(formatWhen('2026-10-11T08:12:00Z', 'UTC', 'en-GB'), /11 Oct.*08:12/);
    assert.equal(formatWhen('not a date'), '—');
  });
  it('puts the newest session first without changing the input', () => {
    const a = session({ startUtc: '2026-10-09T00:00:00Z' });
    const b = session({ startUtc: '2026-10-11T00:00:00Z' });
    const input = [a, b];
    assert.deepEqual(newestFirst(input), [b, a]);
    assert.deepEqual(input, [a, b]);
  });
});

const NOW = Date.parse('2026-10-13T08:00:00Z');
const watching = (over: Partial<BatteryWatching> = {}): BatteryWatching => ({ status: 'Discharging', percent: 83, readingUtc: '2026-10-13T07:59:55Z', understood: true, ...over });

describe('describeWatching', () => {
  it('says it is waiting when no reading has arrived yet', () => {
    const s = describeWatching(null, NOW);
    assert.equal(s.tone, 'warn');
    assert.match(s.text, /first battery reading/);
  });
  it('says what the battery is doing right now when recording works', () => {
    assert.deepEqual(describeWatching(watching(), NOW), { tone: 'ok', text: 'Recording. Right now: on battery, 83%.' });
    assert.match(describeWatching(watching({ status: 'Charging', percent: 40 }), NOW).text, /charging, 40%/);
    assert.match(describeWatching(watching({ status: 'Fully Charged', percent: 100 }), NOW).text, /full, on the charger, 100%/);
    assert.match(describeWatching(watching({ status: 'Not Charging', percent: 80 }), NOW).text, /plugged in, not charging/);
    assert.equal(describeWatching(watching({ percent: null }), NOW).text, 'Recording. Right now: on battery.');
  });
  it('explains a status it cannot use instead of staying silent', () => {
    const s = describeWatching(watching({ status: 'Unknown', understood: false }), NOW);
    assert.equal(s.tone, 'warn');
    assert.match(s.text, /"Unknown".*cannot record changes/);
  });
  it('says so when the readings stopped arriving', () => {
    const old = new Date(NOW - STALE_AFTER_MS - 120_000).toISOString();
    const s = describeWatching(watching({ readingUtc: old }), NOW);
    assert.equal(s.tone, 'warn');
    assert.match(s.text, /No battery reading for 3 min/);
    assert.equal(describeWatching(watching({ readingUtc: new Date(NOW - 30_000).toISOString() }), NOW).tone, 'ok');
  });
});

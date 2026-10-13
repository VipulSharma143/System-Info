import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileCount, formatBytes, historyRange, sharePercent } from '../src/lib/dataUsage.ts';

describe('formatBytes', () => {
  it('uses binary units and a sensible number of digits', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(4647), '4.5 KB');
    assert.equal(formatBytes(1024 * 1024), '1.0 MB');
    assert.equal(formatBytes(12.3 * 1024 * 1024), '12.3 MB');
    assert.equal(formatBytes(250 * 1024 * 1024), '250 MB');
    assert.equal(formatBytes(1.2 * 1024 ** 3), '1.20 GB');
  });
  it('never shows nonsense for bad input', () => {
    assert.equal(formatBytes(-5), '0 B');
    assert.equal(formatBytes(Number.NaN), '0 B');
    assert.equal(formatBytes(Number.POSITIVE_INFINITY), '0 B');
  });
});

describe('historyRange', () => {
  it('says how many days and from when to when', () => {
    assert.equal(historyRange({ historyDays: 12, oldestDay: '2026-10-01', newestDay: '2026-10-12' }, 'en-GB'), '12 days, 1 Oct 2026 to 12 Oct 2026');
    assert.equal(historyRange({ historyDays: 1, oldestDay: '2026-10-12', newestDay: '2026-10-12' }, 'en-GB'), '1 day, 12 Oct 2026');
  });
  it('says so plainly when there is no history', () => {
    assert.equal(historyRange({ historyDays: 0, oldestDay: null, newestDay: null }), 'No history yet');
    assert.equal(historyRange({ historyDays: 3, oldestDay: null, newestDay: null }), 'No history yet');
  });
  it('keeps a date it cannot read instead of failing', () => {
    assert.match(historyRange({ historyDays: 2, oldestDay: 'junk', newestDay: '2026-10-12' }, 'en-GB'), /junk to 12 Oct 2026/);
  });
});

describe('sharePercent / fileCount', () => {
  it('is a share of the total, clamped, and zero when nothing is stored', () => {
    assert.equal(sharePercent({ bytes: 25 }, 100), 25);
    assert.equal(sharePercent({ bytes: 500 }, 100), 100);
    assert.equal(sharePercent({ bytes: 5 }, 0), 0);
  });
  it('counts files in plain words', () => {
    assert.equal(fileCount(0), 'none');
    assert.equal(fileCount(1), '1 file');
    assert.equal(fileCount(1200), '1,200 files');
  });
});

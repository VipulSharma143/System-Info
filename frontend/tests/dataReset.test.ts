import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildRequest, DATA_CATEGORIES, interpretResponse, type DataCategory } from '../src/lib/dataReset.ts';

const pick = (...ids: DataCategory[]) => new Set<DataCategory>(ids);

describe('categories', () => {
  it('lists CPU, GPU, battery, network and other cached information', () => {
    assert.deepEqual(DATA_CATEGORIES.map((c) => c.id), ['cpu', 'gpu', 'battery', 'network', 'cache']);
    assert.ok(DATA_CATEGORIES.every((c) => c.label.length > 0 && c.detail.length > 0));
  });
  it('is honest that no GPU readings are stored over time', () => {
    assert.match(DATA_CATEGORIES.find((c) => c.id === 'gpu')!.detail, /does not keep GPU readings/);
  });
});

describe('buildRequest', () => {
  it('sends nothing when nothing is chosen', () => assert.equal(buildRequest(pick(), false), null));
  it('sends exactly what was chosen, in list order', () => {
    assert.deepEqual(buildRequest(pick('battery', 'cpu'), false), { all: false, categories: ['cpu', 'battery'] });
  });
  it('treats choosing every kind as "delete everything"', () => {
    const all = buildRequest(pick('cpu', 'gpu', 'battery', 'network', 'cache'), false);
    assert.equal(all?.all, true);
    assert.equal(all?.categories.length, 5);
  });
  it('honours an explicit delete-all even with nothing ticked', () => assert.equal(buildRequest(pick(), true)?.all, true));
});

describe('interpretResponse', () => {
  it('only an explicit ok from the backend is success (so the app restarts only after a real delete)', () => {
    assert.deepEqual(interpretResponse(200, { ok: true, message: 'The selected data was deleted.' }), { ok: true, message: 'The selected data was deleted.' });
    assert.equal(interpretResponse(200, { ok: false }).ok, false);
    assert.equal(interpretResponse(200, null).ok, false);
    assert.equal(interpretResponse(200, {}).ok, false);
  });
  it('a failed delete keeps the backend\'s reason, or says what the status was', () => {
    assert.equal(interpretResponse(500, { ok: false, message: 'Some data could not be deleted: x' }).message, 'Some data could not be deleted: x');
    assert.match(interpretResponse(502, null).message, /502/);
    assert.equal(interpretResponse(400, { ok: true }).ok, false, 'an error status is never success');
  });
});

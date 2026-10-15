import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { summarizeEngine } from '../src/lib/engine.ts';
import type { EngineStatus } from '../src/types/engine.ts';

const status = (over: Partial<EngineStatus> = {}, series: Partial<EngineStatus['series']> = {}): EngineStatus => ({
  available: true,
  isa: 'AVX2',
  assembly: true,
  demotedTiers: 0,
  series: { active: true, nativeCalls: 0, managedCalls: 0, minLength: 256, ...series },
  sections: [],
  ...over,
});

describe('summarizeEngine', () => {
  it('names the instruction tier and the calls the engine handled', () => {
    const s = summarizeEngine(status({}, { nativeCalls: 12, managedCalls: 3 }));
    assert.equal(s.headline, 'AVX2');
    assert.equal(s.tone, 'ok');
    assert.match(s.detail, /AVX2 assembly/);
    assert.match(s.detail, /12 history calculations ran on the engine, 3 short ones in plain C#\./);
  });

  it('says so when nothing has been analysed yet, with the size at which the engine takes over', () => {
    const s = summarizeEngine(status());
    assert.match(s.detail, /256 samples or more are handed to the engine; none has been analysed yet/);
  });

  it('uses the singular for one call and groups thousands', () => {
    assert.match(summarizeEngine(status({}, { nativeCalls: 1 })).detail, /1 history calculation ran on the engine\./);
    assert.match(summarizeEngine(status({}, { nativeCalls: 12345 })).detail, /12,345 history calculations/);
  });

  it('warns when the assembly is off or a tier was rejected', () => {
    const off = summarizeEngine(status({ isa: 'Portable C++', assembly: false }));
    assert.equal(off.tone, 'warn');
    assert.equal(off.headline, 'Portable C++');
    assert.match(off.detail, /portable C\+\+ \(assembly is off\)/);
    const demoted = summarizeEngine(status({ isa: 'SSE2', demotedTiers: 1 }));
    assert.equal(demoted.tone, 'warn');
    assert.match(demoted.detail, /rejected 1 assembly tier, so a slower tier is in use/);
  });

  it('explains plainly when the library is not loaded', () => {
    const s = summarizeEngine(status({ available: false, isa: 'Unavailable', assembly: false }, { active: false }));
    assert.equal(s.tone, 'off');
    assert.equal(s.headline, 'Not loaded');
    assert.match(s.detail, /plain C#/);
  });

  it('reports plain C# when the series engine is switched off', () => {
    assert.match(summarizeEngine(status({}, { active: false })).detail, /running in plain C# at the moment/);
  });
});

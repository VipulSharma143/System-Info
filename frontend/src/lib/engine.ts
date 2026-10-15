import type { EngineStatus } from '../types/engine';

export interface EngineSummary {
  /** Short label for the badge. */
  headline: string;
  /** One sentence for the panel. */
  detail: string;
  tone: 'ok' | 'warn' | 'off';
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** Plain-language account of the engine status; every number in it comes from the status itself. */
export function summarizeEngine(status: EngineStatus): EngineSummary {
  if (!status.available) {
    return {
      headline: 'Not loaded',
      detail: 'The native engine is not loaded, so the history maths runs in plain C#. Results are the same, only slower on long histories.',
      tone: 'off',
    };
  }
  const { nativeCalls, managedCalls, minLength } = status.series;
  const where = status.assembly ? `${status.isa} assembly` : 'portable C++ (assembly is off)';
  const demoted = status.demotedTiers > 0
    ? ` The start-up check rejected ${plural(status.demotedTiers, 'assembly tier', 'assembly tiers')}, so a slower tier is in use.`
    : '';
  const work = !status.series.active
    ? 'The history maths is running in plain C# at the moment.'
    : nativeCalls === 0
      ? `Histories of ${minLength.toLocaleString('en-US')} samples or more are handed to the engine; none has been analysed yet.`
      : `${plural(nativeCalls, 'history calculation', 'history calculations')} ran on the engine` +
        (managedCalls > 0 ? `, ${managedCalls.toLocaleString('en-US')} short ones in plain C#.` : '.');
  return {
    headline: status.assembly ? status.isa : 'Portable C++',
    detail: `Trends, statistics and bottleneck scans run through C++ on ${where}. ${work}${demoted}`,
    tone: status.demotedTiers > 0 || !status.assembly ? 'warn' : 'ok',
  };
}

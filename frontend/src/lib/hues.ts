import type { CSSProperties } from 'react';

/** Every subsystem owns one hue (see styles/tokens.css); components tint themselves with it via `--h`. */
export type Hue =
  | 'overview'
  | 'analytics'
  | 'cpu'
  | 'ram'
  | 'disk'
  | 'net'
  | 'power'
  | 'sys'
  | 'updates'
  | 'neutral';

export const hueVar = (hue: Hue) => (hue === 'neutral' ? 'var(--text-muted)' : `var(--hue-${hue})`);

/** Inline style that sets the `--h` custom property for a subtree. */
export const hueStyle = (hue: Hue): CSSProperties => ({ ['--h' as string]: hueVar(hue) });

/** Bars, rings and figures use their subsystem hue until usage becomes worrying, then switch to warn / critical. */
export function usageColor(percent: number | undefined, hue: Hue = 'neutral'): string {
  if (percent === undefined) return hueVar(hue);
  return percent >= 90 ? 'var(--critical)' : percent >= 70 ? 'var(--warn)' : hueVar(hue);
}

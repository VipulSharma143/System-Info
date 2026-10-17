import { useCallback, useEffect, useState } from 'react';
import type { BehaviorState, StartupBehavior } from '../lib/behavior';
import { getBehavior, setBehavior } from '../lib/behaviorClient';
import { reportDiagnostic } from '../lib/errors';
import { isTauri } from '../lib/tauri';

export interface StartupBehaviorResource {
  /** Null while loading, and always null outside the desktop app (a browser tab has nothing to configure). */
  state: BehaviorState | null;
  supported: boolean;
  saving: boolean;
  /** A plain-language problem from the last save, or null. */
  problem: string | null;
  choose: (behavior: StartupBehavior) => Promise<boolean>;
}

/** Reads and changes the background/startup preference held by the desktop shell. */
export function useStartupBehavior(): StartupBehaviorResource {
  const supported = isTauri();
  const [state, setState] = useState<BehaviorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    getBehavior()
      .then((s) => { if (!cancelled) setState(s); })
      .catch((err) => reportDiagnostic('get_startup_behavior failed', err));
    return () => { cancelled = true; };
  }, [supported]);

  const choose = useCallback(async (behavior: StartupBehavior) => {
    setSaving(true);
    setProblem(null);
    try {
      setState(await setBehavior(behavior));
      return true;
    } catch (err) {
      reportDiagnostic('set_startup_behavior failed', err);
      setProblem('The setting could not be saved. Your previous choice is still in effect.');
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  return { state, supported, saving, problem, choose };
}

import { memo } from 'react';
import { Power, TriangleAlert } from 'lucide-react';
import { needsTray } from '../../../lib/behavior';
import { useStartupBehavior } from '../../../hooks/useStartupBehavior';
import Panel from '../../common/Panel';
import { Callout } from '../../common/States';
import BehaviorChoice from './BehaviorChoice';

/** System page: what System Info does when its window is closed and when the computer starts. Applies immediately. */
function BehaviorPanel() {
  const { state, supported, saving, problem, choose } = useStartupBehavior();

  return (
    <Panel title="Background and startup" icon={Power} hue="sys" meta={saving ? 'saving…' : undefined}>
      {!supported ? (
        <p className="text-[13px] leading-relaxed text-muted">This setting belongs to the desktop app. It is not available in a browser tab.</p>
      ) : !state ? (
        <p className="text-[13px] text-muted">Reading the current setting…</p>
      ) : (
        <>
          <BehaviorChoice name="startup-behavior" value={state.behavior} disabled={saving} onChange={(v) => void choose(v)} />
          <p className="mt-3 text-[12px] leading-relaxed text-faint">The change takes effect immediately. Choose Exit in the top bar (or Quit in the tray menu) to close System Info completely.</p>
          {!state.trayAvailable && needsTray(state.behavior) && (
            <div className="mt-3">
              <Callout tone="warn" icon={TriangleAlert}>
                This desktop has no notification area that System Info could use, so closing the window still quits the app. Starting at sign-in still works.
              </Callout>
            </div>
          )}
          {problem && <p role="alert" className="mt-3 text-[12px] leading-relaxed text-critical">{problem}</p>}
        </>
      )}
    </Panel>
  );
}

export default memo(BehaviorPanel);

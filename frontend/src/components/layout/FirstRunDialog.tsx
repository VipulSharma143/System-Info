import { useEffect, useRef, useState } from 'react';
import { useStartupBehavior } from '../../hooks/useStartupBehavior';
import type { StartupBehavior } from '../../lib/behavior';
import Button from '../common/Button';
import BehaviorChoice from '../views/system/BehaviorChoice';

/*
  Asked once, on the first launch of a fresh installation. The desktop shell reports `firstRun` only when there was no
  earlier installation and no saved choice (the Windows installer asks the same question itself and stores the answer,
  so it never gets here); an update never asks. The choice can be changed later on the System page.
*/
export default function FirstRunDialog() {
  const { state, saving, problem, choose } = useStartupBehavior();
  const dialog = useRef<HTMLDialogElement>(null);
  const [picked, setPicked] = useState<StartupBehavior>('off');
  const [done, setDone] = useState(false);
  const open = state?.firstRun === true && !done;

  useEffect(() => {
    const el = dialog.current;
    if (open && el && !el.open) el.showModal();
  }, [open]);

  if (!open) return null;

  const confirm = async () => {
    if (await choose(picked)) {
      setDone(true);
      dialog.current?.close();
    }
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="first-run-title"
      onCancel={(e) => e.preventDefault()}
      className="m-auto w-[min(34rem,92vw)] rounded-[var(--r-lg)] border border-line-strong bg-surface p-0 text-ink backdrop:bg-black/50"
    >
      <div className="p-5">
        <h2 id="first-run-title" className="num text-[16px] font-semibold">Welcome to System Info</h2>
        <p className="mt-1 text-[13px] text-muted">Choose how System Info should behave. You can change this later on the System page.</p>
        <div className="mt-4">
          <BehaviorChoice name="first-run-behavior" value={picked} onChange={setPicked} disabled={saving} />
        </div>
        {problem && <p role="alert" className="mt-3 text-[12px] text-critical">{problem}</p>}
        <div className="mt-5 flex justify-end">
          <Button loading={saving} onClick={() => void confirm()}>Continue</Button>
        </div>
      </div>
    </dialog>
  );
}

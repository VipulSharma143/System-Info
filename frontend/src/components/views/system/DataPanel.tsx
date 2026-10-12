import { memo, useRef, useState } from 'react';
import { Database, Trash2 } from 'lucide-react';
import { buildRequest, DATA_CATEGORIES, type DataCategory } from '../../../lib/dataReset';
import { resetData, restartApp } from '../../../lib/dataResetClient';
import Button from '../../common/Button';
import Panel from '../../common/Panel';

const RETENTION_DAYS = 7;

/** System page: where the saved history lives, and the button that deletes it (after asking which parts). */
function DataPanel() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<ReadonlySet<DataCategory>>(new Set());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const everything = selected.size === DATA_CATEGORIES.length;
  const open = () => { setSelected(new Set()); setProblem(null); dialog.current?.showModal(); };
  const close = () => { if (!busy) dialog.current?.close(); };
  const toggle = (id: DataCategory) => setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleAll = () => setSelected(everything ? new Set() : new Set(DATA_CATEGORIES.map((c) => c.id)));

  const request = buildRequest(selected, false);
  const confirm = async () => {
    if (!request) return;
    setBusy(true);
    setProblem(null);
    const outcome = await resetData(request);
    if (outcome.ok) { await restartApp(); return; }   // the app restarts; nothing more to show
    setProblem(outcome.message);
    setBusy(false);
  };

  return (
    <Panel
      title="Saved data"
      icon={Database}
      hue="sys"
      action={<Button variant="danger" size="sm" icon={Trash2} onClick={open}>Reset data…</Button>}
    >
      <p className="text-[13px] leading-relaxed text-muted">
        System Info keeps its history in local files on this computer and deletes anything older than {RETENTION_DAYS} days automatically.
        You can also delete it yourself: you will be asked which data, and the app restarts afterwards.
      </p>

      <dialog
        ref={dialog}
        aria-labelledby="reset-title"
        className="m-auto w-[min(32rem,92vw)] rounded-[var(--r-lg)] border border-line-strong bg-surface p-0 text-ink backdrop:bg-black/50"
      >
        <div className="p-5">
          <h2 id="reset-title" className="num text-[15px] font-semibold">Reset saved data</h2>
          <p className="mt-1 text-[13px] text-muted">Choose what to delete.</p>

          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-[var(--r-md)] bg-surface-2 px-3 py-2.5">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={everything} onChange={toggleAll} disabled={busy} />
            <span>
              <span className="block text-[13px] font-medium">Delete everything</span>
              <span className="block text-[12px] text-muted">All of the data below, including the whole history folder</span>
            </span>
          </label>

          <ul className="mt-2 space-y-1">
            {DATA_CATEGORIES.map((c) => (
              <li key={c.id}>
                <label className="flex cursor-pointer items-start gap-3 rounded-[var(--r-md)] px-3 py-2 hover:bg-surface-2">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={selected.has(c.id)} onChange={() => toggle(c.id)} disabled={busy} />
                  <span>
                    <span className="block text-[13px] font-medium">{c.label}</span>
                    <span className="block text-[12px] text-muted">{c.detail}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <p className="mt-4 text-[12px] leading-relaxed text-muted">This cannot be undone. System Info restarts as soon as the data is deleted.</p>
          {problem && <p role="alert" className="mt-2 text-[12px] leading-relaxed text-critical">{problem}</p>}

          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
            <Button variant="danger" icon={Trash2} loading={busy} disabled={!request} onClick={confirm}>Delete and restart</Button>
          </div>
        </div>
      </dialog>
    </Panel>
  );
}

export default memo(DataPanel);

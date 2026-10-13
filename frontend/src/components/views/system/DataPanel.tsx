import { memo, useRef, useState } from 'react';
import { Database, Trash2 } from 'lucide-react';
import { useJsonResource } from '../../../hooks/useJsonResource';
import { fileCount, formatBytes, historyRange, sharePercent } from '../../../lib/dataUsage';
import type { DataUsage } from '../../../types/dataUsage';
import { buildRequest, DATA_CATEGORIES, type DataCategory } from '../../../lib/dataReset';
import { resetData, restartApp } from '../../../lib/dataResetClient';
import Button from '../../common/Button';
import Panel from '../../common/Panel';
import UsageBar from '../../common/UsageBar';

const BATTERY_DAYS = 7;
const USAGE_POLL_MS = 15_000;

/** System page: how much space the saved data uses, where it lives, and the one button that deletes it (after asking which parts). */
function DataPanel({ active }: { active: boolean }) {
  const usage = useJsonResource<DataUsage>('/api/data/usage', { active, intervalMs: USAGE_POLL_MS });
  const sizes = usage.data;
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
        System Info keeps its CPU, network and battery history in local files on this computer. It keeps growing until you delete it here;
        only the battery charging history is limited, to the last {BATTERY_DAYS} days. You will be asked which data to delete, and the app restarts afterwards.
      </p>

      {sizes ? (
        <div className="mt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-[12px] text-muted">Space used by saved data</span>
            <span className="num text-[15px] font-semibold text-ink">{formatBytes(sizes.totalBytes)}</span>
          </div>
          <div className="mt-0.5 text-[12px] text-faint">History covers {historyRange(sizes)}</div>
          <ul className="mt-3 space-y-2.5">
            {sizes.parts.map((p) => (
              <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-[12px]">
                <span className="truncate text-muted">{p.label}</span>
                <span className="num text-right text-ink">{formatBytes(p.bytes)}<span className="ml-1.5 text-faint">· {fileCount(p.files)}</span></span>
                <div className="col-span-2"><UsageBar percent={sharePercent(p, sizes.totalBytes)} compact hue="sys" hideValue /></div>
              </li>
            ))}
          </ul>
          <div className="mt-3 break-all text-[11px] text-faint">Stored in <span className="select-all">{sizes.path}</span></div>
        </div>
      ) : usage.error ? (
        <p className="mt-3 text-[12px] text-muted">The size of the saved data could not be read right now.</p>
      ) : null}

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

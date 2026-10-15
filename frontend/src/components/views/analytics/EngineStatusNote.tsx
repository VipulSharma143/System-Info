import { memo } from 'react';
import { Cpu } from 'lucide-react';
import { useJsonResource } from '../../../hooks/useJsonResource';
import { summarizeEngine } from '../../../lib/engine';
import type { EngineStatus } from '../../../types/engine';
import Panel from '../../common/Panel';

/*
  Shows which part of the stack did the maths behind this page: the native engine (C++ over the Assembly kernels) or plain
  C#. It reads /api/native/engine once per mount; the Analytics page remounts it when the time range changes, so the call
  counts are as current as the numbers above it. If the status cannot be read the note simply is not shown.
*/
function EngineStatusNote({ active }: { active: boolean }) {
  const engine = useJsonResource<EngineStatus>('/api/native/engine', { active });
  if (!engine.data) return null;
  const summary = summarizeEngine(engine.data);

  return (
    <Panel title="Compute engine" icon={Cpu} hue="analytics" meta={summary.headline}>
      <p className="text-[13px] text-muted">{summary.detail}</p>
      {engine.data.sections.length > 0 && (
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-2">
          {engine.data.sections.map((s) => (
            <div key={s.name} className="min-w-0">
              <dt className="font-medium text-ink">{s.name}</dt>
              <dd className="text-muted">{s.kernels} · {s.usedBy}</dd>
            </div>
          ))}
        </dl>
      )}
    </Panel>
  );
}

export default memo(EngineStatusNote);

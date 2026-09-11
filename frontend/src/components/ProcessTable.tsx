import { useMemo, useState } from 'react';
import type { ProcessInfo } from '../types/system';

interface ProcessTableProps {
  processes: ProcessInfo[];
}

export default function ProcessTable({ processes }: ProcessTableProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) return processes;
    const q = query.toLowerCase();
    return processes.filter((p) => p.name.toLowerCase().includes(q) || String(p.pid).includes(q));
  }, [processes, query]);

  if (processes.length === 0) return null;

  return (
    <div className="panel">
      <div className="panel__title panel__title--with-action">
        <span>Processes · by memory</span>
        <input
          className="search-input"
          type="text"
          placeholder="Filter by name or PID"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="panel__scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>PID</th>
              <th>Name</th>
              <th>Memory (MB)</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.pid}>
                <td>{p.pid}</td>
                <td>{p.name}</td>
                <td>{p.memoryMB}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="panel__empty">No processes match "{query}".</p>}
      </div>
    </div>
  );
}

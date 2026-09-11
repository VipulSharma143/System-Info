import type { NetworkInfo } from '../types/system';

interface NetworkTableProps {
  network: NetworkInfo[];
}

export default function NetworkTable({ network }: NetworkTableProps) {
  if (network.length === 0) return null;

  return (
    <div className="panel">
      <h2 className="panel__title">Network</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Interface</th>
            <th>Down (KB/s)</th>
            <th>Up (KB/s)</th>
          </tr>
        </thead>
        <tbody>
          {network.map((n) => (
            <tr key={n.iface}>
              <td>{n.iface}</td>
              <td>{n.rxKBps}</td>
              <td>{n.txKBps}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

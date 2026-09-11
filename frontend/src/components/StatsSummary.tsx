import type { StatsResponse } from '../types/analytics';

interface StatsSummaryProps {
  stats: StatsResponse;
}

export default function StatsSummary({ stats }: StatsSummaryProps) {
  return (
    <div className="analytics-block">
      <h3 className="analytics-block__title">
        Stats <span className="analytics-block__meta">{stats.count} samples</span>
      </h3>
      <p className="analytics-block__lead">
        CPU mean {stats.cpu_percent.mean}% · min {stats.cpu_percent.min}% · max {stats.cpu_percent.max}%
      </p>
      <table className="data-table">
        <thead>
          <tr>
            <th>Interface</th>
            <th>RX KB/s (mean / min / max)</th>
            <th>TX KB/s (mean / min / max)</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(stats.network).map(([iface, n]) => (
            <tr key={iface}>
              <td>{iface}</td>
              <td>
                {n.rx_kbps.mean} / {n.rx_kbps.min} / {n.rx_kbps.max}
              </td>
              <td>
                {n.tx_kbps.mean} / {n.tx_kbps.min} / {n.tx_kbps.max}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

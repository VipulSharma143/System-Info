import { useEffect, useState } from 'react';

interface RamInfo {
  totalMB: number;
  usedMB: number;
  availableMB: number;
  usedPercent: number;
}

interface CpuInfo {
  usedPercent: number;
}

interface ProcessInfo {
  pid: number;
  name: string;
  memoryMB: number;
}

interface DiskInfo {
  name: string;
  volumeLabel: string;
  driveType: string;
  totalGB: number;
  freeGB: number;
  usedGB: number;
  usedPercent: number;
}

interface NetworkInfo {
  iface: string;
  rxKBps: number;
  txKBps: number;
}

const API_BASE = 'http://localhost:5132';

function App() {
  const [ram, setRam] = useState<RamInfo | null>(null);
  const [cpu, setCpu] = useState<CpuInfo | null>(null);
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [disks, setDisks] = useState<DiskInfo[]>([]);
  const [network, setNetwork] = useState<NetworkInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = () => {
      Promise.all([
        fetch(`${API_BASE}/api/system/ram`).then((r) => r.json()),
        fetch(`${API_BASE}/api/system/cpu`).then((r) => r.json()),
        fetch(`${API_BASE}/api/system/processes`).then((r) => r.json()),
        fetch(`${API_BASE}/api/system/disk`).then((r) => r.json()),
        fetch(`${API_BASE}/api/system/network`).then((r) => r.json()),
      ])
        .then(([ramData, cpuData, processData, diskData, networkData]) => {
          setRam(ramData);
          setCpu(cpuData);
          setProcesses(processData);
          setDisks(diskData);
          setNetwork(networkData);
          setError(null);
        })
        .catch((err) => setError(err.message));
    };

    fetchData();
    const interval = setInterval(fetchData, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif', maxWidth: '900px', margin: '0 auto' }}>
      <h1>System Monitor</h1>
      {error && <p style={{ color: 'red' }}>Error: {error}</p>}

      {cpu && <h2>CPU Usage: {cpu.usedPercent}%</h2>}

      {ram && (
        <div style={{ marginBottom: '1.5rem' }}>
          <h2>RAM Usage: {ram.usedPercent}%</h2>
          <p>
            {ram.usedMB} MB used / {ram.totalMB} MB total ({ram.availableMB} MB available)
          </p>
        </div>
      )}

      {disks.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <h2>Disk Usage</h2>
          <table border={1} cellPadding={6} style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th>Mount</th>
                <th>Type</th>
                <th>Used</th>
                <th>Total</th>
                <th>Used %</th>
              </tr>
            </thead>
            <tbody>
              {disks.map((d) => (
                <tr key={d.name}>
                  <td>{d.name}</td>
                  <td>{d.driveType}</td>
                  <td>{d.usedGB} GB</td>
                  <td>{d.totalGB} GB</td>
                  <td>{d.usedPercent}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {network.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <h2>Network Usage</h2>
          <table border={1} cellPadding={6} style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th>Interface</th>
                <th>Download (KB/s)</th>
                <th>Upload (KB/s)</th>
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
      )}

      {processes.length > 0 && (
        <div>
          <h2>Top Processes (by memory)</h2>
          <table border={1} cellPadding={6} style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th>PID</th>
                <th>Name</th>
                <th>Memory (MB)</th>
              </tr>
            </thead>
            <tbody>
              {processes.map((p) => (
                <tr key={p.pid}>
                  <td>{p.pid}</td>
                  <td>{p.name}</td>
                  <td>{p.memoryMB}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default App;
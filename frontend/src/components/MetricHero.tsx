import type { CpuInfo, RamInfo } from '../types/system';
import { severity } from '../lib/format';

interface MetricHeroProps {
  cpu: CpuInfo;
  ram: RamInfo;
}

export default function MetricHero({ cpu, ram }: MetricHeroProps) {
  return (
    <section className="hero-grid">
      <div className={`hero-card hero-card--${severity(cpu.usedPercent)}`}>
        <span className="hero-card__label">CPU</span>
        <span className="hero-card__value">
          {cpu.usedPercent.toFixed(1)}
          <span className="hero-card__unit">%</span>
        </span>
      </div>

      <div className={`hero-card hero-card--${severity(ram.usedPercent)}`}>
        <span className="hero-card__label">RAM</span>
        <span className="hero-card__value">
          {ram.usedPercent.toFixed(1)}
          <span className="hero-card__unit">%</span>
        </span>
        <span className="hero-card__detail">
          {ram.usedMB.toLocaleString()} / {ram.totalMB.toLocaleString()} MB ·{' '}
          {ram.availableMB.toLocaleString()} MB free
        </span>
      </div>
    </section>
  );
}

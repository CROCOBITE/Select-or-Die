import React from 'react';
import { useTooltip } from './ui.jsx';

const DAY = 86400000;
const fmt = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

/** Milestone timeline: planned window as a thin bar, slippage to today as a dashed line, labelled. */
export function ScheduleChart({ rows, today }) {
  const [bind, tip] = useTooltip();
  const items = rows.filter((r) => r.end);
  if (!items.length) return <p className="pz-muted">No dated milestones in the plan.</p>;
  const t = new Date(today).getTime();
  const starts = items.map((r) => new Date(r.start || r.end).getTime());
  const ends = items.map((r) => new Date(r.end).getTime());
  const min = Math.min(...starts, t) - 3 * DAY;
  const max = Math.max(...ends, t) + 3 * DAY;
  const W = 1100;
  const L = 56;
  const R = 90;
  const rowH = 24;
  const H = items.length * rowH + 30;
  const x = (v) => L + ((v - min) / (max - min)) * (W - L - R);
  const ticks = [];
  for (let d = new Date(min); d <= max; d = new Date(d.getTime() + 7 * DAY)) ticks.push(d.getTime());

  return (
    <>
      <svg className="pz-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Milestone schedule against the baseline, with slippage to today">
        {ticks.map((v) => (
          <g key={v}>
            <line className="grid" x1={x(v)} x2={x(v)} y1={16} y2={H - 6} />
            <text x={x(v)} y={11} textAnchor="middle">{fmt(v)}</text>
          </g>
        ))}
        <line className="today" x1={x(t)} x2={x(t)} y1={14} y2={H - 4} />
        <text x={x(t) + 4} y={H - 8} className="label">today</text>
        {items.map((r, i) => {
          const y = 22 + i * rowH;
          const s = new Date(r.start || r.end).getTime();
          const e = new Date(r.end).getTime();
          const w = Math.max(4, x(e) - x(s));
          const label = `${r.id} · ${r.name} · ${r.start ? `${fmt(s)} – ` : ''}${fmt(e)} · ${r.status || 'no status'}${r.daysLate ? ` · ${r.daysLate} days past baseline` : ''}`;
          return (
            <g key={r.id} {...bind(label)}>
              <rect className="hit" x={L} y={y - 4} width={W - L} height={rowH} />
              <text x={L - 8} y={y + 9} textAnchor="end" className="label">{r.id}</text>
              <rect className="bar" x={x(s)} y={y + 2} width={w} height={10} rx={4} />
              {r.daysLate > 0 && <line className="slip" x1={x(e)} x2={x(t)} y1={y + 7} y2={y + 7} />}
              <text x={Math.max(x(e), r.daysLate ? x(t) : 0) + 6} y={y + 11}>
                {r.daysLate > 0 ? `+${r.daysLate} d` : r.status ? r.status.slice(0, 18) : ''}
              </text>
            </g>
          );
        })}
      </svg>
      {tip}
    </>
  );
}

/** Horizontal bars for a single measure (one series → one hue, no legend; title names it). */
export function BarList({ data, unit = '' }) {
  const [bind, tip] = useTooltip();
  const entries = Object.entries(data || {});
  if (!entries.length) return <p className="pz-muted">No data.</p>;
  const max = Math.max(...entries.map(([, v]) => v));
  const W = 420;
  const L = 70;
  const rowH = 24;
  const H = entries.length * rowH + 6;
  return (
    <>
      <svg className="pz-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={entries.map(([k, v]) => `${k}: ${v}${unit}`).join(', ')}>
        {entries.map(([k, v], i) => {
          const y = 4 + i * rowH;
          const w = Math.max(4, (v / max) * (W - L - 40));
          return (
            <g key={k} {...bind(`${k}: ${v}${unit}`)}>
              <rect className="hit" x={0} y={y} width={W} height={rowH} />
              <text x={L - 8} y={y + 14} textAnchor="end" className="label">{k}</text>
              <rect className="bar" x={L} y={y + 5} width={w} height={12} rx={4} />
              <text x={L + w + 6} y={y + 15}>{v}{unit}</text>
            </g>
          );
        })}
      </svg>
      {tip}
    </>
  );
}

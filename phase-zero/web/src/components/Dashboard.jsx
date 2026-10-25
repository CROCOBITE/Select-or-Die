import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { RagPill, ErrorNote } from './ui.jsx';
import { ScheduleChart, BarList } from './Charts.jsx';

const Tile = ({ value, label, warn }) => (
  <div className="pz-tile">
    <div className="v">{value}</div>
    <div className="l">{label} {warn && <span className="pz-pill medium">{warn}</span>}</div>
  </div>
);

function Table({ rows, cols }) {
  if (!rows?.length) return <p className="pz-muted">None.</p>;
  return (
    <div className="pz-table-wrap">
      <table className="pz-table">
        <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c}>{/rag/i.test(c) ? <RagPill value={r[c]} /> : /owner/i.test(c) && /tbc/i.test(r[c] || '') ? <span className="pz-pill medium">{r[c]}</span> : r[c] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Dashboard({ project, artifacts }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setD(null);
    api.get(`/api/projects/${project.id}/dashboard`).then(setD, (e) => setError(e.message));
  }, [project.id, artifacts.map((a) => a.currentVersion).join()]);

  if (error) return <ErrorNote error={error} />;
  if (!d) return <p className="pz-muted">Loading dashboard…</p>;
  const keys = new Set(artifacts.map((a) => a.key));
  const missing = ['CHARTER', 'STORIES', 'PLAN', 'RAID', 'WEEKLY'].filter((k) => !keys.has(k));
  const late = d.schedule.filter((s) => s.daysLate > 0);
  const passedGates = project.gates.filter((g) => g.status === 'passed').length;

  return (
    <>
      <section className="pz-card">
        <h2>Decisions required</h2>
        <Table rows={d.decisions} cols={Object.keys(d.decisions[0] || { Decision: '' })} />
      </section>

      <section className="pz-card">
        <h2>Actions due in the next 7 days</h2>
        <Table
          rows={d.dueSoon.map((a) => ({ ...a, 'Days to due': a.daysToDue === null ? 'no date' : a.daysToDue < 0 ? `${-a.daysToDue} overdue` : a.daysToDue }))}
          cols={['ID', 'Action', 'Owner', 'Due date', 'Days to due', 'RAG', 'Status']}
        />
      </section>

      <section className="pz-tiles" aria-label="Indicators">
        <Tile value={late.length} label="Milestones past reference date (lagging)" />
        <Tile value={d.raid.openRisks} label="Open risks (leading)" warn={d.raid.risksByRag.High ? `${d.raid.risksByRag.High} High` : null} />
        <Tile value={d.raid.openIssues} label="Open issues" warn={d.raid.issuesByRag.High ? `${d.raid.issuesByRag.High} High` : null} />
        <Tile value={d.raid.ownersTbc} label="Entries with owner TBC" warn={d.raid.ownersTbc ? 'resolve' : null} />
        <Tile value={d.raid.assumptionsUnconfirmed} label="Unconfirmed assumptions" />
        <Tile value={d.backlog.total} label="Backlog stories" />
        <Tile value={`${passedGates}/6`} label="Gates passed" />
        {missing.map((k) => <Tile key={k} value="—" label={`${k} not supplied – owner TBC`} warn="missing" />)}
      </section>

      <section className="pz-card">
        <h2>Schedule against reference dates (proposed)</h2>
        <p className="pz-muted">Bar = reference window. Dashed line = slippage to today ({d.today}). Hover a row for details; the schedule table below has every value.</p>
        <ScheduleChart rows={d.schedule} today={d.today} />
      </section>

      <div className="pz-grid-2">
        <section className="pz-card">
          <h2>Backlog stories by epic</h2>
          <BarList data={d.backlog.byEpic} />
          <h3>By priority</h3>
          <BarList data={d.backlog.byPriority} />
          <p className="pz-muted">{d.backlog.withOpenQuestions} stories carry open questions for the Product Owner.</p>
        </section>
        <section className="pz-card">
          <h2>Top risks (High)</h2>
          <Table rows={d.raid.topRisks} cols={['ID', 'Risk', 'RAG', 'Owner']} />
        </section>
      </div>

      <section className="pz-card">
        <h2>Open issues</h2>
        <Table rows={d.raid.topIssues} cols={['ID', 'Issue', 'RAG', 'Owner', 'Raised', 'Age (days)']} />
      </section>

      <section className="pz-card">
        <h2>Schedule table</h2>
        <Table rows={d.schedule.map((s) => ({ ID: s.id, Milestone: s.name, Start: s.start ?? '–', Finish: s.end ?? '–', Status: s.status, 'Days past reference date': s.daysLate || '' }))} cols={['ID', 'Milestone', 'Start', 'Finish', 'Status', 'Days past reference date']} />
      </section>
    </>
  );
}

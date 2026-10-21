import React, { useState } from 'react';
import { api } from '../api.js';
import { ErrorNote, Field } from './ui.jsx';

export default function Tickets() {
  const [csv, setCsv] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [r, setR] = useState(null);
  const [error, setError] = useState('');

  const run = async () => {
    setError('');
    try { setR(await api.post('/api/tickets/analyse', { csv, periodEnd: periodEnd || null })); } catch (e) { setError(e.message); }
  };
  const readFile = (e) => {
    const f = e.target.files?.[0];
    if (f) f.text().then(setCsv);
  };

  return (
    <>
      <section className="pz-card">
        <h2>Ticket export analyser</h2>
        <p className="pz-muted">
          Upload the ticket export as CSV. Status values with flag characters (for example 🚩Open) are matched on their letters.
          Rows raised after the period end are excluded, because the export date is not the period end. Rows with no status
          give a range, not a number. Every total is checked against the others. Nothing leaves this computer.
        </p>
        <div className="pz-form">
          <Field label="Period end (optional)"><input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} /></Field>
          <Field label="Export file (.csv)"><input type="file" accept=".csv,.txt" onChange={readFile} /></Field>
        </div>
        <textarea className="pz-editor" style={{ minHeight: 160, marginTop: 8 }} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="ID,Status,Owning Team,Priority,Owner,Due Date,Created On,Resolved On" aria-label="Ticket CSV" />
        <div className="pz-row" style={{ marginTop: 8 }}>
          <button className="pz-btn primary" disabled={!csv.trim()} onClick={run}>Analyse</button>
          <span className="pz-muted">Team groups come from workspace/config.json → "ticketGroups".</span>
        </div>
      </section>
      <ErrorNote error={error} />
      {r && (
        <>
          <section className="pz-tiles">
            <div className="pz-tile"><div className="v">{r.rows}</div><div className="l">rows in period{r.excludedAfterPeriod ? ` (${r.excludedAfterPeriod} after period excluded)` : ''}</div></div>
            <div className="pz-tile"><div className="v">{r.status.open}</div><div className="l">open (Open · Committed · On hold)</div></div>
            <div className="pz-tile"><div className="v">{r.status.closed}</div><div className="l">closed</div></div>
            <div className="pz-tile"><div className="v">{r.status.unstatused}</div><div className="l">no status, no resolved date</div></div>
            <div className="pz-tile"><div className="v">{r.triageRate === null ? '–' : `${r.triageRate}%`}</div><div className="l">triage rate (priority + owner + due ÷ open)</div></div>
          </section>
          <section className="pz-card">
            <h2>Reconciliation checks</h2>
            {r.checks.map((c) => (
              <div key={c.name} className="pz-row"><span className={c.result === 'OK' ? 'pz-ok' : 'pz-bad'}>{c.result}</span> {c.name} <span className="pz-muted">({c.detail})</span></div>
            ))}
            {r.notes.length > 0 && (<><h3>Notes</h3><ul>{r.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></>)}
          </section>
          <section className="pz-card">
            <h2>By team group</h2>
            <div className="pz-table-wrap">
              <table className="pz-table">
                <thead><tr><th>Group</th><th>Total</th><th>Open</th><th>Closed</th><th>No status</th><th>Open rate</th></tr></thead>
                <tbody>
                  {Object.entries(r.groups).map(([g, v]) => (
                    <tr key={g}>
                      <td>{g}</td><td>{v.total}</td><td>{v.open}</td><td>{v.closed}</td><td>{v.unstatused}</td>
                      <td>{v.openRateRange ? `${v.openRateRange[0]}% – ${v.openRateRange[1]}% (range)` : v.openRate === null ? '–' : `${v.openRate}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="pz-muted">Columns used: {Object.entries(r.columns).map(([k, v]) => `${k} = ${v || 'not found'}`).join(' · ')}</p>
          </section>
        </>
      )}
    </>
  );
}

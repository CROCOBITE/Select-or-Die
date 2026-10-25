import React, { useState } from 'react';
import { api } from '../api.js';
import { ErrorNote } from './ui.jsx';

export default function Publish({ project, status, user }) {
  const [preview, setPreview] = useState(null);
  const [phrase, setPhrase] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try { setPreview(await api.post(`/api/projects/${project.id}/ado/preview`)); } catch (e) { setError(e.message); }
  };
  const approve = async () => {
    setError('');
    try {
      setResult(await api.post(`/api/projects/${project.id}/ado/approve`, { phrase, by: user }));
      setPhrase('');
    } catch (e) { setError(e.message); }
  };
  const exact = phrase.trim() === status.approvalPhrase;

  return (
    <>
      <section className="pz-card">
        <h2>Publish backlog to Azure DevOps</h2>
        <p>
          Nothing is written to Azure DevOps until the Project Owner types the approval phrase <strong>exactly</strong>.
          Approval creates a publish manifest in the local outbox, recording who approved, when, and which version.
        </p>
        <p className="pz-muted">
          Target: {status.ado ? `${status.ado.project} › ${status.ado.areaPath}${status.ado.backlog ? ` › ${status.ado.backlog}` : ''}` : 'not configured (workspace/config.json → "ado")'}
        </p>
        <button className="pz-btn" onClick={load}>Preview items from the current STORIES version</button>
      </section>
      <ErrorNote error={error} />
      {preview && (
        <section className="pz-card">
          <h2>Preview · STORIES v{preview.version}</h2>
          <p className="pz-muted">{Object.entries(preview.counts).map(([k, v]) => `${v} ${k}`).join(' · ')}</p>
          <div className="pz-table-wrap" style={{ maxHeight: 360 }}>
            <table className="pz-table">
              <thead><tr><th>Ref</th><th>Type</th><th>Title</th><th>Parent</th><th>Priority</th></tr></thead>
              <tbody>{preview.items.map((i) => <tr key={i.ref}><td>{i.ref}</td><td>{i.type}</td><td>{i.title}</td><td>{i.parent || '–'}</td><td>{i.priority ?? ''}</td></tr>)}</tbody>
            </table>
          </div>
          <h3>Approval</h3>
          <p>Type: <code>{status.approvalPhrase}</code></p>
          <div className="pz-row">
            <input
              style={{ flex: 1, minWidth: 260 }}
              className="pz-btn"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              onPaste={(e) => e.preventDefault()}
              placeholder="Type the approval phrase (paste is disabled)"
              aria-label="Approval phrase"
            />
            <button className="pz-btn primary" disabled={!exact || !user} onClick={approve}>Approve as {user || '…'}</button>
          </div>
          {!exact && phrase && <p className="pz-muted">The phrase does not match exactly yet (case and spelling matter).</p>}
        </section>
      )}
      {result && (
        <section className="pz-card">
          <h2>Approved</h2>
          <p>Manifest written to <code>{result.outbox}</code> ({Object.entries(result.counts).map(([k, v]) => `${v} ${k}`).join(', ')}).</p>
          <p className="pz-muted">Approval {result.approval.id} · {result.approval.by} · {new Date(result.approval.at).toLocaleString()} · STORIES v{result.approval.version} (sha {result.approval.sha}).</p>
        </section>
      )}
    </>
  );
}

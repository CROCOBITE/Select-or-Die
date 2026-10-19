import React, { useState } from 'react';
import { api } from '../api.js';
import { ErrorNote } from './ui.jsx';

const KIND_CLASS = { Issue: 'high', Risk: 'medium', Decision: 'navy', Action: '' };

export default function Teams({ project, user }) {
  const [text, setText] = useState('');
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const extract = async () => {
    setError('');
    try { setItems((await api.post(`/api/projects/${project.id}/teams`, { text, by: user })).extracted); } catch (e) { setError(e.message); }
  };
  const readFile = (e) => {
    const f = e.target.files?.[0];
    if (f) f.text().then(setText);
  };
  const asMarkdown = () =>
    `| Kind | Text | Owner | Due | Said by | When |\n|---|---|---|---|---|---|\n${items
      .map((c) => `| ${c.kind} | ${c.text.replace(/\|/g, '/')} | ${c.owner} | ${c.due} | ${c.author} | ${c.at} |`)
      .join('\n')}`;
  const copy = async () => {
    await navigator.clipboard.writeText(asMarkdown());
    setCopied(true);
  };

  return (
    <>
      <section className="pz-card">
        <h2>Weekly Teams chat log</h2>
        <p className="pz-muted">
          Paste or upload this week's Microsoft Teams thread. Phase Zero lists the decisions, actions, risks and issues it finds.
          You confirm each one and add it to the RAID log yourself. Nothing is added automatically, and the text never leaves this computer.
        </p>
        <textarea className="pz-editor" style={{ minHeight: 220 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="[19/10/2026 10:15] Name: message…" aria-label="Teams chat log" />
        <div className="pz-row" style={{ marginTop: 8 }}>
          <input type="file" accept=".txt,.md,.csv,.log" onChange={readFile} aria-label="Upload chat export" />
          <button className="pz-btn primary" disabled={!text.trim()} onClick={extract}>Extract RAID candidates</button>
        </div>
      </section>
      <ErrorNote error={error} />
      {items && (
        <section className="pz-card">
          <div className="pz-header">
            <h2>{items.length} candidates</h2>
            <button className="pz-btn" onClick={copy}>{copied ? 'Copied' : 'Copy as RAID table'}</button>
          </div>
          <div className="pz-table-wrap">
            <table className="pz-table">
              <thead><tr><th>Kind</th><th>Text</th><th>Owner</th><th>Due</th><th>Said by</th><th>When</th></tr></thead>
              <tbody>
                {items.map((c, i) => (
                  <tr key={i}>
                    <td><span className={`pz-pill ${KIND_CLASS[c.kind]}`}>{c.kind}</span></td>
                    <td>{c.text}</td>
                    <td>{/tbc/i.test(c.owner) ? <span className="pz-pill medium">{c.owner}</span> : c.owner}</td>
                    <td>{c.due}</td>
                    <td>{c.author}</td>
                    <td className="pz-muted">{c.at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

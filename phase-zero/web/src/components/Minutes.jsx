import React, { useState } from 'react';
import { api } from '../api.js';
import { ErrorNote, Field, Markdown } from './ui.jsx';

const META = [['title', 'Meeting title'], ['date', 'Date / time'], ['purpose', 'Purpose'], ['requestedBy', 'Requested by'], ['hostedBy', 'Hosted by'], ['attendees', 'Attendees']];

export default function Minutes({ project, user, onSaved }) {
  const [notes, setNotes] = useState('');
  const [meta, setMeta] = useState({ hostedBy: user });
  const [out, setOut] = useState(null);
  const [error, setError] = useState('');

  const build = async (save) => {
    setError('');
    try {
      const r = await api.post(`/api/projects/${project.id}/minutes`, { notes, meta, save, by: user });
      setOut(r);
      if (save) onSaved(r.artifactId);
    } catch (e) { setError(e.message); }
  };

  return (
    <>
      <section className="pz-card">
        <h2>Meeting minutes from your notes</h2>
        <p className="pz-muted">
          Paste your raw notes. Your own wording is kept under "Discussion – as written". Lines that start with "My conclusion",
          "PMO:" or "As PMO" go into a separate PMO-judgement section, because the team did not agree them. QA-versus-team
          disagreements are flagged as CONFLICT. System names are written as "DevOps" and "Tickets System".
        </p>
        <div className="pz-form">
          {META.map(([k, l]) => <Field key={k} label={l}><input value={meta[k] || ''} onChange={(e) => setMeta({ ...meta, [k]: e.target.value })} /></Field>)}
        </div>
        <textarea className="pz-editor" style={{ minHeight: 180, marginTop: 8 }} value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Meeting notes" placeholder={'QA says … but the Mobile team says …\nWe agreed to …\n@Name please … by 23/10\nMy conclusion as PMO: …'} />
        <div className="pz-row" style={{ marginTop: 8 }}>
          <button className="pz-btn" disabled={!notes.trim()} onClick={() => build(false)}>Preview minutes</button>
          <button className="pz-btn primary" disabled={!notes.trim()} onClick={() => build(true)}>Save as a versioned artifact</button>
        </div>
      </section>
      <ErrorNote error={error} />
      {out && (
        <section className="pz-card">
          <div className="pz-row">
            <span className="pz-pill high">{out.conflicts.length} conflicts</span>
            <span className="pz-pill info">{out.candidates.filter((c) => c.kind === 'Decision').length} decisions</span>
            <span className="pz-pill">{out.candidates.filter((c) => c.kind === 'Action').length} actions</span>
            <span className="pz-pill medium">{out.judgements.length} PMO judgement</span>
          </div>
          <Markdown text={out.markdown} />
        </section>
      )}
    </>
  );
}

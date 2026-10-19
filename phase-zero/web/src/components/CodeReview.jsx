import React, { useState } from 'react';
import { api } from '../api.js';
import { ErrorNote } from './ui.jsx';
import { Findings, LiveConfirm } from './Artifacts.jsx';

const LIVE_SKILLS = ['refactor', 'frontend-design-review', 'angular-security-perf', 'dotnet-best-practices', 'refactor-method-complexity-reduce'];

export default function CodeReview({ status }) {
  const [result, setResult] = useState(null);
  const [skill, setSkill] = useState('refactor');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (mode) => {
    setBusy(true);
    setError('');
    try { setResult(await api.post('/api/code-review', { mode, skill, confirm: mode === 'live' })); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <>
      <section className="pz-card">
        <h2>Code review of Phase Zero itself</h2>
        <p className="pz-muted">
          Runs the code-review skills (refactor, method complexity, frontend design/a11y, security) over this tool's own
          server and front-end source. Offline rules run locally; a live review sends the source code (not project content) to Claude after you confirm.
        </p>
        <div className="pz-row">
          <button className="pz-btn primary" disabled={busy} onClick={() => run('offline')}>Run offline rules</button>
          <select value={skill} onChange={(e) => setSkill(e.target.value)} aria-label="Skill for live review">
            {LIVE_SKILLS.map((s) => <option key={s}>{s}</option>)}
          </select>
          <button className="pz-btn" disabled={busy || !status.liveAi} onClick={() => setConfirm(true)}>Live review (asks first)</button>
        </div>
      </section>
      <ErrorNote error={error} />
      {result && (
        <section className="pz-card">
          <h2>{result.mode === 'live' ? `Live · ${result.skill}` : 'Offline rules'}{result.score !== undefined ? ` · score ${result.score}` : ''}</h2>
          {result.summary && <p>{result.summary}</p>}
          <Findings findings={result.findings} />
        </section>
      )}
      {confirm && (
        <LiveConfirm
          what={`Phase Zero's own source files will be reviewed against the ${skill} skill.`}
          onClose={() => setConfirm(false)}
          onConfirm={() => { setConfirm(false); run('live'); }}
        />
      )}
    </>
  );
}

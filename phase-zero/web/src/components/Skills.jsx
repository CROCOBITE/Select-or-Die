import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ErrorNote } from './ui.jsx';

export default function Skills() {
  const [skills, setSkills] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/api/skills').then(setSkills, (e) => setError(e.message)); }, []);
  if (error) return <ErrorNote error={error} />;
  if (!skills) return <p className="pz-muted">Loading skills…</p>;
  return (
    <>
      <section className="pz-card">
        <h2>Skills checklist</h2>
        <p className="pz-muted">
          Each skill with what it gives you, where it stops, and where Phase Zero applies it. "Skill text" shows whether the
          full skill file is in your private workspace (used by live reviews).
        </p>
        <div className="pz-table-wrap">
          <table className="pz-table">
            <thead><tr><th>Skill</th><th>Purpose</th><th>Reviewers in Phase Zero</th><th>Skill text</th></tr></thead>
            <tbody>
              {skills.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.name}</strong><div className="pz-muted">{s.id}</div></td>
                  <td>{s.purpose}</td>
                  <td>{s.reviewers.length ? s.reviewers.join(' · ') : <span className="pz-muted">applied as a feature, not a reviewer</span>}</td>
                  <td>{s.textAvailable ? <span className="pz-ok">✓ loaded</span> : <span className="pz-pill medium">not in workspace</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {skills.map((s) => (
        <section className="pz-card" key={s.id}>
          <h2>{s.name}</h2>
          <p>{s.purpose}</p>
          <div className="pz-check">
            <div>
              <h3>Benefits</h3>
              <ul>{s.benefits.map((b, i) => <li key={i}>{b}</li>)}</ul>
            </div>
            <div>
              <h3>Boundaries</h3>
              <ul>{s.boundaries.map((b, i) => <li key={i}>{b}</li>)}</ul>
            </div>
          </div>
          <h3>Coded into Phase Zero</h3>
          <ul>{s.coded.map((c, i) => <li key={i}><span className="pz-ok">✓</span> {c}</li>)}</ul>
        </section>
      ))}
    </>
  );
}

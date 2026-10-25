import React, { useEffect, useState } from 'react';
import { api, exportUrl } from '../api.js';
import { Markdown, Modal, Field, ErrorNote, RagPill } from './ui.jsx';

const SEV = { blocker: 'high', major: 'high', minor: 'medium', info: '' };

export function Findings({ findings }) {
  if (!findings?.length) return <p className="pz-muted">No findings.</p>;
  return findings.map((f, i) => (
    <div className="pz-finding" key={i}>
      <span className={`pz-pill ${SEV[f.severity] || ''}`}>{f.severity}</span>
      <div>
        <strong>{f.rule}</strong>{f.where ? <span className="pz-muted"> · {f.where}</span> : null}
        <div>{f.message}</div>
      </div>
    </div>
  ));
}

export function LiveConfirm({ what, onConfirm, onClose }) {
  return (
    <Modal title="Send to Claude for a live review?" onClose={onClose}>
      <p>{what}</p>
      <ul>
        <li>The content leaves this computer and is sent to the Claude API.</li>
        <li>E-mail addresses and long numbers (IDs, phones) are masked first. Names and other text are <strong>not</strong> masked.</li>
        <li>The result is stored as a review on the current version.</li>
      </ul>
      <div className="pz-row">
        <button className="pz-btn primary" onClick={onConfirm}>Yes, send it</button>
        <button className="pz-btn" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

function History({ art, user, reload }) {
  const [from, setFrom] = useState(Math.max(1, art.currentVersion - 1));
  const [to, setTo] = useState(art.currentVersion);
  const [diff, setDiff] = useState(null);
  const [error, setError] = useState('');
  const [sign, setSign] = useState({ role: '', comment: '', decision: 'approved' });

  useEffect(() => {
    if (from === to) return setDiff(null);
    api.get(`/api/artifacts/${art.id}/diff?from=${from}&to=${to}`).then(setDiff, (e) => setError(e.message));
  }, [art.id, from, to]);

  const restore = async (n) => {
    try {
      await api.post(`/api/artifacts/${art.id}/restore`, { n, author: user });
      reload();
    } catch (e) { setError(e.message); }
  };
  const signoff = async () => {
    try {
      await api.post(`/api/artifacts/${art.id}/signoff`, { n: art.currentVersion, by: user, ...sign });
      reload();
    } catch (e) { setError(e.message); }
  };

  return (
    <div className="pz-grid-2">
      <div>
        <h3>Versions</h3>
        <div className="pz-table-wrap">
          <table className="pz-table">
            <thead><tr><th>v</th><th>When</th><th>By</th><th>Message</th><th>sha</th><th /></tr></thead>
            <tbody>
              {[...art.versions].reverse().map((v) => (
                <tr key={v.n}>
                  <td>{v.n}{v.n === art.currentVersion && <span className="pz-pill navy"> current</span>}</td>
                  <td>{new Date(v.createdAt).toLocaleString()}</td>
                  <td>{v.author}</td>
                  <td>{v.message}{v.restoredFrom ? ` (from v${v.restoredFrom})` : ''}</td>
                  <td><code>{v.sha}</code></td>
                  <td>{v.n !== art.currentVersion && <button className="pz-btn" onClick={() => restore(v.n)}>Restore</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>Sign-offs</h3>
        {art.signoffs.length ? art.signoffs.map((s, i) => (
          <div key={i} className="pz-muted">v{s.n} · <strong>{s.decision}</strong> by {s.by}{s.role ? ` (${s.role})` : ''} · {new Date(s.at).toLocaleString()}{s.comment ? ` · “${s.comment}”` : ''}</div>
        )) : <p className="pz-muted">No sign-off yet.</p>}
        <h3>Sign off v{art.currentVersion}</h3>
        <div className="pz-form">
          <Field label="Role"><input value={sign.role} onChange={(e) => setSign({ ...sign, role: e.target.value })} placeholder="e.g. Project Owner" /></Field>
          <Field label="Decision">
            <select value={sign.decision} onChange={(e) => setSign({ ...sign, decision: e.target.value })}>
              <option value="approved">Approved</option>
              <option value="changes-requested">Changes requested</option>
            </select>
          </Field>
          <Field label="Comment"><input value={sign.comment} onChange={(e) => setSign({ ...sign, comment: e.target.value })} /></Field>
        </div>
        <div className="pz-row" style={{ marginTop: 8 }}>
          <button className="pz-btn primary" onClick={signoff} disabled={!user}>Sign off as {user || '…'}</button>
          {!user && <span className="pz-muted">Enter your name at the top to sign.</span>}
        </div>
      </div>
      <div>
        <h3>Compare</h3>
        <div className="pz-row">
          <label>From <select value={from} onChange={(e) => setFrom(+e.target.value)}>{art.versions.map((v) => <option key={v.n}>{v.n}</option>)}</select></label>
          <label>To <select value={to} onChange={(e) => setTo(+e.target.value)}>{art.versions.map((v) => <option key={v.n}>{v.n}</option>)}</select></label>
          {diff && <span className="pz-muted">+{diff.stats.added} / −{diff.stats.removed} lines</span>}
        </div>
        <ErrorNote error={error} />
        {diff ? (
          <div className="pz-diff">
            {diff.ops.map((o, i) =>
              o.op === ' ' ? null : <div key={i} className={o.op === '+' ? 'add' : 'del'}>{o.op} {o.text || ' '}</div>
            )}
            {!diff.stats.added && !diff.stats.removed && <p className="pz-muted">No differences.</p>}
          </div>
        ) : <p className="pz-muted">Pick two different versions to compare.</p>}
      </div>
    </div>
  );
}

function Reviews({ art, status, user, reload }) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null);

  const run = async (reviewer, mode) => {
    setBusy(`${reviewer}:${mode}`);
    setError('');
    try {
      setResult(await api.post(`/api/artifacts/${art.id}/review`, { reviewer, mode, confirm: mode === 'live', by: user }));
      reload();
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  const open = async (rid) => setResult(await api.get(`/api/artifacts/${art.id}/reviews/${rid}`));

  return (
    <div className="pz-grid-2">
      <div>
        <h3>Skills that apply to this artifact</h3>
        {!art.reviewers.length && <p className="pz-muted">No reviewer is registered for type “{art.type}”.</p>}
        {art.reviewers.map((r) => (
          <div key={r.id} className="pz-reviewer">
            <div><strong>{r.name}</strong> <span className="pz-pill navy">{r.skill}</span></div>
            <div className="pz-row">
              <button className="pz-btn" disabled={!!busy} onClick={() => run(r.id, 'offline')}>{busy === `${r.id}:offline` ? 'Running…' : 'Run offline'}</button>
              <button className="pz-btn" disabled={!!busy || !status.liveAi} title={status.liveAi ? '' : 'Set ANTHROPIC_API_KEY to enable'} onClick={() => setConfirm(r)}>
                {busy === `${r.id}:live` ? 'Reviewing…' : 'Live review (asks first)'}
              </button>
            </div>
          </div>
        ))}
        {!status.liveAi && <p className="pz-muted">Live review is off: no Claude API credentials on this machine. Offline rules still run.</p>}
        <h3>Review history</h3>
        {art.reviews.length ? [...art.reviews].reverse().map((r) => (
          <div key={r.id} className="pz-row pz-muted">
            <button className="pz-btn" onClick={() => open(r.id)}>Open</button>
            v{r.n} · {r.name || r.skill} · {r.mode} · score {r.score} · {r.findingCount} findings · {new Date(r.at).toLocaleString()}
          </div>
        )) : <p className="pz-muted">No reviews yet.</p>}
      </div>
      <div>
        <ErrorNote error={error} />
        {result ? (
          <>
            <h3>{result.name || result.skill} · v{result.n} · {result.mode} · score {result.score}</h3>
            {result.summary && <p>{result.summary}</p>}
            {result.stories && (
              <p className="pz-muted">{result.stories.filter((s) => s.ready).length} of {result.stories.length} stories ready.</p>
            )}
            {result.estimates && (
              <div className="pz-table-wrap">
                <table className="pz-table">
                  <thead><tr><th>Story</th><th>UCP</th><th>Weight (approx.)</th></tr></thead>
                  <tbody>{result.estimates.map((e) => <tr key={e.id}><td>{e.id} · {e.title}</td><td>{e.points}</td><td>{e.weight >= 13 ? <RagPill value="High" /> : e.weight}</td></tr>)}</tbody>
                </table>
              </div>
            )}
            <Findings findings={result.findings} />
          </>
        ) : <p className="pz-muted">Run a review to see findings here.</p>}
      </div>
      {confirm && (
        <LiveConfirm
          what={`“${art.title}” v${art.currentVersion} will be reviewed against the ${confirm.skill} skill.`}
          onClose={() => setConfirm(null)}
          onConfirm={() => { const r = confirm; setConfirm(null); run(r.id, 'live'); }}
        />
      )}
    </div>
  );
}

function ArtifactView({ id, status, user, onChanged }) {
  const [art, setArt] = useState(null);
  const [tab, setTab] = useState('preview');
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const load = () => api.get(`/api/artifacts/${id}`).then((a) => { setArt(a); setDraft(a.content); }, (e) => setError(e.message));
  useEffect(() => { setTab('preview'); load(); }, [id]);
  const reload = () => { load(); onChanged(); };

  const save = async () => {
    setError('');
    try {
      const r = await api.put(`/api/artifacts/${id}`, { content: draft, author: user, message });
      setSaved(r.unchanged ? 'No changes to save.' : `Saved as v${r.version.n}.`);
      setMessage('');
      reload();
    } catch (e) { setError(e.message); }
  };

  if (!art) return error ? <ErrorNote error={error} /> : <p className="pz-muted">Loading…</p>;
  const dirty = draft !== art.content;
  return (
    <section className="pz-card">
      <div className="pz-header">
        <div>
          <h1 style={{ fontSize: 18 }}>{art.title}</h1>
          <p className="pz-muted">{art.key} · {art.type} · gate {art.gate || '–'} · v{art.currentVersion} · {art.status} {art.signedOff && <span className="pz-pill navy">signed off</span>}</p>
        </div>
        <div className="pz-row">
          {['md', 'docx', 'xlsx'].map((f) => <a key={f} className="pz-btn" href={exportUrl(art.id, f)}>{f === 'md' ? 'Markdown' : f === 'docx' ? 'Word' : 'Excel'}</a>)}
          {art.type === 'executive' && <a className="pz-btn primary" href={exportUrl(art.id, 'html')}>Executive page (HTML)</a>}
        </div>
      </div>
      <div className="pz-tabs" role="tablist">
        {[['preview', 'Preview'], ['edit', `Edit${dirty ? ' •' : ''}`], ['history', `History (${art.versions.length})`], ['reviews', 'AI skill reviews']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <ErrorNote error={error} />
      {tab === 'preview' && <Markdown text={art.content} />}
      {tab === 'edit' && (
        <div style={{ display: 'grid', gap: 8 }}>
          <textarea className="pz-editor" value={draft} onChange={(e) => { setDraft(e.target.value); setSaved(''); }} aria-label="Markdown source" spellCheck />
          <div className="pz-row">
            <input style={{ flex: 1, minWidth: 220 }} className="pz-btn" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Change message (required) – what changed and why" />
            <button className="pz-btn primary" onClick={save} disabled={!dirty || !message.trim()}>Save new version</button>
            <button className="pz-btn" onClick={() => setDraft(art.content)} disabled={!dirty}>Discard</button>
            {saved && <span className="pz-muted">{saved}</span>}
          </div>
        </div>
      )}
      {tab === 'history' && <History art={art} user={user} reload={reload} />}
      {tab === 'reviews' && <Reviews art={art} status={status} user={user} reload={reload} />}
    </section>
  );
}

function NewFromTemplate({ project, user, onCreated }) {
  const [teams, setTeams] = useState('');
  const [error, setError] = useState('');
  const create = async (type) => {
    setError('');
    try {
      const a = await api.post(`/api/projects/${project.id}/artifacts`, { type, by: user, teams: teams.split(',').map((t) => t.trim()).filter(Boolean).join('\n') });
      onCreated(a.id);
    } catch (e) { setError(e.message); }
  };
  return (
    <div className="pz-row" style={{ marginBottom: 10 }}>
      <button className="pz-btn" onClick={() => create('kpi-reply')}>+ Leadership KPI reply (Table A / B)</button>
      <input className="pz-btn" value={teams} onChange={(e) => setTeams(e.target.value)} placeholder="Teams for the executive page, comma-separated" aria-label="Teams" />
      <button className="pz-btn" onClick={() => create('executive')}>+ Executive per-team page</button>
      <ErrorNote error={error} />
    </div>
  );
}

export default function Artifacts({ project, artifacts, status, user, onChanged, selected, onSelect }) {
  const current = selected && artifacts.find((a) => a.id === selected);
  return (
    <>
      <section className="pz-card">
        <h2>Artifacts</h2>
        {project && <NewFromTemplate project={project} user={user} onCreated={(id) => { onChanged(); onSelect(id); }} />}
        <div className="pz-table-wrap">
          <table className="pz-table">
            <thead><tr><th>Key</th><th>Title</th><th>Gate</th><th>Version</th><th>Last change</th><th>Review score</th><th>Sign-off</th></tr></thead>
            <tbody>
              {artifacts.map((a) => (
                <tr key={a.id}>
                  <td><button className="pz-btn" aria-current={a.id === selected} onClick={() => onSelect(a.id)}>{a.key}</button></td>
                  <td>{a.title}</td>
                  <td>{a.gate}</td>
                  <td>v{a.currentVersion}</td>
                  <td className="pz-muted">{new Date(a.updatedAt).toLocaleDateString()} · {a.updatedBy}</td>
                  <td>{a.reviewScore === null ? <span className="pz-muted">not reviewed</span> : a.reviewScore < 70 ? <RagPill value={`High · ${a.reviewScore}`} /> : a.reviewScore < 90 ? <RagPill value={`Medium · ${a.reviewScore}`} /> : a.reviewScore}</td>
                  <td>{a.signedOff ? <span className="pz-pill navy">signed</span> : <span className="pz-muted">open</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {current && <ArtifactView id={current.id} status={status} user={user} onChanged={onChanged} />}
    </>
  );
}

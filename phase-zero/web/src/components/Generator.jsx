import React, { useState } from 'react';
import { api } from '../api.js';
import { Field, ErrorNote } from './ui.jsx';

const FIELDS = [
  ['name', 'Project name', 'input'],
  ['pm', 'Project manager', 'input'],
  ['sponsor', 'Sponsor (leave blank if not named)', 'input'],
  ['businessOwner', 'Business owner', 'input'],
  ['approver', 'Report approver', 'input'],
  ['teamType', 'Team type', 'select'],
  ['goal', 'Business goal – what the business wants to achieve', 'textarea', 'wide'],
  ['problem', 'The problem today', 'textarea', 'wide'],
  ['objectives', 'Objectives – one per line: objective | measure | target', 'textarea', 'wide'],
  ['capabilities', 'Capabilities – one per line, optionally "Role: capability"', 'textarea', 'wide'],
  ['inScope', 'In scope – one per line', 'textarea'],
  ['outScope', 'Out of scope – one per line', 'textarea'],
  ['risks', 'Known risks – one per line', 'textarea'],
  ['teams', 'Delivery teams – one per line', 'textarea'],
  ['startDate', 'Gate 1 date', 'date'],
  ['goLive', 'Target go-live', 'date'],
];

export default function Generator({ onCreated }) {
  const [form, setForm] = useState({ teamType: 'medical' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const p = await api.post('/api/projects', form);
      onCreated(p.id);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <section className="pz-card">
      <h2>New project from a business goal</h2>
      <p className="pz-muted">
        Phase Zero drafts the charter, story skeletons, plan, RAID log, weekly report and release-notes templates.
        Anything you leave blank is written as “not set” or “TBC”, never guessed. Then refine each artifact,
        run the skill reviews, and sign off gate by gate.
      </p>
      <div className="pz-form">
        {FIELDS.map(([k, label, kind, wide]) => (
          <div key={k} className={wide ? 'wide' : ''}>
            <Field label={label}>
              {kind === 'textarea' ? <textarea value={form[k] || ''} onChange={set(k)} /> :
               kind === 'select' ? (
                 <select value={form[k]} onChange={set(k)}>
                   <option value="medical">Medical (clinical / patient-facing)</option>
                   <option value="non-medical">Non-medical (HR, finance, web…)</option>
                 </select>
               ) : <input type={kind === 'date' ? 'date' : 'text'} value={form[k] || ''} onChange={set(k)} />}
            </Field>
          </div>
        ))}
      </div>
      <ErrorNote error={error} />
      <div className="pz-row" style={{ marginTop: 12 }}>
        <button className="pz-btn primary" disabled={busy || !form.name?.trim() || !form.goal?.trim()} onClick={create}>
          {busy ? 'Creating…' : 'Create project and draft artifacts'}
        </button>
        <span className="pz-muted">Name and business goal are required.</span>
      </div>
    </section>
  );
}

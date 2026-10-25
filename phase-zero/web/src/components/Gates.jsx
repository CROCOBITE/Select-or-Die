import React, { useState } from 'react';
import { api } from '../api.js';
import { ErrorNote } from './ui.jsx';

// The PM's step-by-step guide per gate (PMBOK 8 hybrid). Each step names the artifact that proves it.
export const GUIDE = {
  G0: {
    name: 'Discovery',
    domains: 'Governance · Stakeholders',
    steps: [
      ['Read every source; list the ones you could not read and why', 'SRC'],
      ['Write each conflict between sources as a decision for the owner, never pick silently', 'DEC'],
      ['Ask the business goal, the problem today, and who owns the outcome', 'CHARTER'],
    ],
    questions: ['Which source is authoritative when two disagree?', 'Who is the Project Owner and who signs as Sponsor?'],
  },
  G1: {
    name: 'Initiation',
    domains: 'Governance · Scope · Stakeholders',
    steps: [
      ['Charter: purpose, problem, measurable objectives, in/out of scope, milestones, people, risks, decisions', 'CHARTER'],
      ['Every date labelled Proposed until its owner commits capacity', 'CHARTER'],
      ['Sponsor named; TBC owners visible, never invented', 'CHARTER'],
      ['Run the Solution-value and Charter reviews; fix majors', 'CHARTER'],
    ],
    questions: ['Is each objective measurable with a baseline and an owner?', 'What is explicitly out of scope?'],
  },
  G2: {
    name: 'Planning',
    domains: 'Scope · Schedule · Resources · Risk · Finance',
    steps: [
      ['Stories Epic › Feature › Story, each traced to a source section', 'STORIES'],
      ['INVEST + Definition of Ready review passes for every story planned in the next sprint', 'STORIES'],
      ['WBS, gates, baseline schedule, critical path and a forecast with its assumption', 'PLAN'],
      ['RAID baselined: every action has Owner · Due date · RAG · Status', 'RAID'],
      ['Publish to Azure DevOps only after the Project Owner types the approval phrase', 'STORIES'],
    ],
    questions: ['What breaks the forecast?', 'Which dependency sits on the critical path?'],
  },
  G3: {
    name: 'Build',
    domains: 'Schedule · Resources · Scope',
    steps: [
      ['Each sprint: goal, committed items, carryover fate (re-planned / descoped / stranded)', 'WEEKLY'],
      ['Weekly: RAID first, report second; Thursday data-request pack', 'RAID'],
      ['Run code-review skills on every delivered increment', null],
      ['Release notes per deployment', 'RELNOTES'],
    ],
    questions: ['Is completion % comparable week to week, or flattered by abandoned carryover?'],
  },
  G4: {
    name: 'Quality',
    domains: 'Scope · Risk · Stakeholders',
    steps: [
      ['SIT and UAT evidence against every acceptance criterion', 'STORIES'],
      ['Security and privacy review signed', 'RAID'],
      ['Sign-off matrix complete', 'PLAN'],
    ],
    questions: ['Which acceptance criteria have no evidence yet?'],
  },
  G5: {
    name: 'Transition & Control',
    domains: 'Governance · Risk · Finance',
    steps: [
      ['Go / no-go criteria agreed in advance and met', 'PLAN'],
      ['Rollback plan tested; hypercare owner and end date named', 'PLAN'],
      ['KPI baseline captured; benefits owner named', 'CHARTER'],
      ['Week conclusion checklist complete every week', 'RELNOTES'],
    ],
    questions: ['Who owns the benefits after hypercare closes?'],
  },
};

export default function Gates({ project, artifacts, user, onChanged, onOpen }) {
  const [note, setNote] = useState({});
  const [error, setError] = useState('');
  const set = async (gate, status) => {
    setError('');
    try {
      await api.post(`/api/projects/${project.id}/gates/${gate}`, { status, by: user, note: note[gate] || '' });
      onChanged();
    } catch (e) { setError(e.message); }
  };
  const art = (key) => artifacts.find((a) => a.key === key);

  return (
    <>
      <ErrorNote error={error} />
      {project.gates.map((g) => {
        const guide = GUIDE[g.gate];
        return (
          <section className="pz-card" key={g.gate}>
            <div className="pz-header">
              <div>
                <h2>{g.gate} · {guide.name} <span className="pz-muted">({guide.domains})</span></h2>
                <p className="pz-muted">
                  Status: <span className={`pz-pill ${g.status === 'passed' ? 'navy' : g.status === 'blocked' ? 'high' : ''}`}>{g.status}</span>
                  {g.signedBy && ` · ${g.signedBy} · ${new Date(g.at).toLocaleString()}`}{g.note && ` · “${g.note}”`}
                </p>
              </div>
              <div className="pz-row">
                <input className="pz-btn" placeholder="Gate note" value={note[g.gate] || ''} onChange={(e) => setNote({ ...note, [g.gate]: e.target.value })} />
                <button className="pz-btn primary" disabled={!user} onClick={() => set(g.gate, 'passed')}>Pass gate</button>
                <button className="pz-btn danger" disabled={!user} onClick={() => set(g.gate, 'blocked')}>Block</button>
                <button className="pz-btn" disabled={!user} onClick={() => set(g.gate, 'open')}>Re-open</button>
              </div>
            </div>
            <ol>
              {guide.steps.map(([text, key], i) => {
                const a = key && art(key);
                return (
                  <li key={i}>
                    {text}{' '}
                    {a ? (
                      <button className="pz-btn" onClick={() => onOpen(a.id)}>
                        {a.key} v{a.currentVersion}{a.signedOff ? ' · signed' : ''}{a.reviewScore !== null ? ` · score ${a.reviewScore}` : ''}
                      </button>
                    ) : key ? <span className="pz-pill medium">{key} not supplied</span> : null}
                  </li>
                );
              })}
            </ol>
            <p className="pz-muted">Questions to answer before passing: {guide.questions.join(' · ')}</p>
          </section>
        );
      })}
    </>
  );
}

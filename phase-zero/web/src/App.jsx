import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import Dashboard from './components/Dashboard.jsx';
import Artifacts from './components/Artifacts.jsx';
import Gates from './components/Gates.jsx';
import Generator from './components/Generator.jsx';
import Publish from './components/Publish.jsx';
import Teams from './components/Teams.jsx';
import CodeReview from './components/CodeReview.jsx';
import { ErrorNote } from './components/ui.jsx';

const VIEWS = [
  ['dashboard', 'Dashboard'],
  ['gates', 'Gates & PMO guide'],
  ['artifacts', 'Artifacts & versions'],
  ['teams', 'Teams chat log'],
  ['publish', 'Publish to ADO'],
  ['code', 'Code review'],
  ['new', '+ New project'],
];

const remember = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };
const recall = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };

export default function App() {
  const [status, setStatus] = useState(null);
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(recall('pz.project'));
  const [project, setProject] = useState(null);
  const [view, setView] = useState('dashboard');
  const [selected, setSelected] = useState('');
  const [user, setUser] = useState(recall('pz.user'));
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/status').then(setStatus, (e) => setError(e.message));
    api.get('/api/projects').then((ps) => {
      setProjects(ps);
      if (!ps.some((p) => p.id === projectId) && ps[0]) setProjectId(ps[0].id);
    }, (e) => setError(e.message));
  }, []);

  const loadProject = useCallback(() => {
    if (!projectId) return;
    remember('pz.project', projectId);
    api.get(`/api/projects/${projectId}`).then(setProject, (e) => setError(e.message));
  }, [projectId]);
  useEffect(loadProject, [loadProject]);

  const openArtifact = (id) => { setSelected(id); setView('artifacts'); };
  const created = async (id) => {
    setProjects(await api.get('/api/projects'));
    setProjectId(id);
    setView('dashboard');
  };

  return (
    <div className="pz-shell">
      <nav className="pz-nav" aria-label="Main">
        <div className="pz-brand">Phase Zero<small>Business analysis · PMO · version control</small></div>
        <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setSelected(''); }} aria-label="Project">
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {VIEWS.map(([k, label]) => (
          <button key={k} className="pz-navitem" aria-current={view === k ? 'page' : undefined} onClick={() => setView(k)}>{label}</button>
        ))}
        <div className="pz-navfoot">
          {status && <>Live AI: {status.liveAi ? `on (${status.model})` : 'off'}<br />Workspace: {status.workspace}</>}
        </div>
      </nav>
      <main className="pz-main">
        <header className="pz-header">
          <div>
            <h1>{view === 'new' ? 'New project' : project?.name || 'Phase Zero'}</h1>
            {project && view !== 'new' && <p>{project.goal}</p>}
          </div>
          <label className="pz-row">
            <span className="pz-muted">Signed in as</span>
            <input className="pz-btn" value={user} onChange={(e) => { setUser(e.target.value); remember('pz.user', e.target.value); }} placeholder="Your name (for versions & sign-off)" />
          </label>
        </header>
        <ErrorNote error={error} />
        {view === 'new' && <Generator onCreated={created} />}
        {view === 'code' && status && <CodeReview status={status} />}
        {project && status && (
          <>
            {view === 'dashboard' && <Dashboard project={project} artifacts={project.artifacts} />}
            {view === 'gates' && <Gates project={project} artifacts={project.artifacts} user={user} onChanged={loadProject} onOpen={openArtifact} />}
            {view === 'artifacts' && <Artifacts artifacts={project.artifacts} status={status} user={user} onChanged={loadProject} selected={selected} onSelect={setSelected} />}
            {view === 'teams' && <Teams project={project} user={user} />}
            {view === 'publish' && <Publish project={project} status={status} user={user} />}
          </>
        )}
        {!projects.length && view !== 'new' && <p className="pz-muted">No projects yet. Create one from a business goal.</p>}
      </main>
    </div>
  );
}

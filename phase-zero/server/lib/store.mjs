// Local-first JSON store with append-only version history for every artifact.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const EMPTY = () => ({
  schema: 1,
  projects: [],
  artifacts: [],
  versions: [],
  signoffs: [],
  reviews: [],
  gates: [],
  approvals: [],
  teamsLogs: [],
  audit: [],
});

export const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
const id = (p) => `${p}_${crypto.randomBytes(5).toString('hex')}`;
const now = () => new Date().toISOString();

export class Store {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = fs.existsSync(file) ? { ...EMPTY(), ...JSON.parse(fs.readFileSync(file, 'utf8')) } : EMPTY();
  }

  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2));
    fs.renameSync(tmp, this.file);
  }

  log(event, detail = {}, actor = 'system') {
    this.db.audit.push({ at: now(), actor, event, ...detail });
  }

  // Projects ---------------------------------------------------------------
  createProject({ name, goal = '', owner = '' }, actor) {
    const p = { id: id('prj'), name, goal, owner, createdAt: now() };
    this.db.projects.push(p);
    for (const gate of ['G0', 'G1', 'G2', 'G3', 'G4', 'G5']) {
      this.db.gates.push({ projectId: p.id, gate, status: 'open', signedBy: null, at: null, note: '' });
    }
    this.log('project.created', { projectId: p.id, name }, actor);
    this.save();
    return p;
  }

  project(projectId) {
    return this.db.projects.find((p) => p.id === projectId);
  }

  // Artifacts & versions -----------------------------------------------------
  createArtifact({ projectId, key, title, type, gate, content, author, message }) {
    const a = { id: id('art'), projectId, key, title, type, gate, currentVersion: 0, createdAt: now() };
    this.db.artifacts.push(a);
    this.commit(a.id, { content, author, message: message || 'Initial version' });
    return a;
  }

  artifact(artifactId) {
    return this.db.artifacts.find((a) => a.id === artifactId);
  }

  artifacts(projectId) {
    return this.db.artifacts.filter((a) => a.projectId === projectId);
  }

  versions(artifactId) {
    return this.db.versions.filter((v) => v.artifactId === artifactId).sort((a, b) => a.n - b.n);
  }

  version(artifactId, n) {
    return this.db.versions.find((v) => v.artifactId === artifactId && v.n === Number(n));
  }

  /** Appends a new version. Identical content is a no-op so history stays meaningful. */
  commit(artifactId, { content, author = 'unknown', message = '', restoredFrom = null }) {
    const a = this.artifact(artifactId);
    if (!a) throw new Error(`Unknown artifact ${artifactId}`);
    const prev = this.version(artifactId, a.currentVersion);
    const hash = sha(content);
    if (prev && prev.sha === hash) return { version: prev, unchanged: true };
    const v = {
      id: id('ver'),
      artifactId,
      n: a.currentVersion + 1,
      parent: a.currentVersion || null,
      sha: hash,
      content,
      author,
      message,
      restoredFrom,
      createdAt: now(),
    };
    this.db.versions.push(v);
    a.currentVersion = v.n;
    this.log('artifact.committed', { artifactId, n: v.n, sha: hash, message }, author);
    this.save();
    return { version: v, unchanged: false };
  }

  restore(artifactId, n, author) {
    const v = this.version(artifactId, n);
    if (!v) throw new Error(`Version ${n} not found`);
    return this.commit(artifactId, { content: v.content, author, message: `Restore v${n}`, restoredFrom: v.n });
  }

  // Sign-off & gates ---------------------------------------------------------
  signoff(artifactId, { n, by, role, decision = 'approved', comment = '' }) {
    const v = this.version(artifactId, n);
    if (!v) throw new Error(`Version ${n} not found`);
    const s = { artifactId, n: v.n, sha: v.sha, by, role, decision, comment, at: now() };
    this.db.signoffs.push(s);
    this.log('artifact.signoff', { artifactId, n: v.n, decision }, by);
    this.save();
    return s;
  }

  signoffs(artifactId) {
    return this.db.signoffs.filter((s) => s.artifactId === artifactId);
  }

  gates(projectId) {
    return this.db.gates.filter((g) => g.projectId === projectId);
  }

  setGate(projectId, gate, { status, by, note = '' }) {
    const g = this.db.gates.find((x) => x.projectId === projectId && x.gate === gate);
    if (!g) throw new Error(`Unknown gate ${gate}`);
    Object.assign(g, { status, signedBy: by, at: now(), note });
    this.log('gate.updated', { projectId, gate, status }, by);
    this.save();
    return g;
  }

  // Reviews, approvals, Teams logs -------------------------------------------
  addReview(review) {
    const r = { id: id('rev'), at: now(), ...review };
    this.db.reviews.push(r);
    this.log('review.recorded', { artifactId: r.artifactId, skill: r.skill, mode: r.mode }, r.by || 'system');
    this.save();
    return r;
  }

  reviews(artifactId) {
    return this.db.reviews.filter((r) => r.artifactId === artifactId);
  }

  addApproval(a) {
    const rec = { id: id('apr'), at: now(), status: 'approved-pending-publish', ...a };
    this.db.approvals.push(rec);
    this.log('ado.approval', { projectId: a.projectId, items: a.items?.length ?? 0 }, a.by);
    this.save();
    return rec;
  }

  addTeamsLog(entry) {
    const rec = { id: id('tms'), at: now(), ...entry };
    this.db.teamsLogs.push(rec);
    this.log('teams.imported', { projectId: entry.projectId, items: entry.extracted?.length ?? 0 }, entry.by);
    this.save();
    return rec;
  }
}

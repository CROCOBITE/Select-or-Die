// Phase Zero – local-first business-analysis & PMO server. Zero runtime dependencies
// (the Anthropic SDK is optional and only loaded for a human-confirmed live review).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './lib/store.mjs';
import { parseFrontMatter, parseTables } from './lib/md.mjs';
import { diffLines, diffStats } from './lib/diff.mjs';
import { markdownToDocx } from './lib/docx.mjs';
import { tablesToXlsx } from './lib/xlsx.mjs';
import { REVIEWERS, reviewersFor, runReview, reviewCode } from './lib/reviews.mjs';
import { generateArtifacts } from './lib/generator.mjs';
import { liveReview, loadSkillText, MODEL } from './lib/ai.mjs';
import { APPROVAL_PHRASE, isApproved, buildManifest, manifestToMarkdown, validateTarget } from './lib/ado.mjs';
import { SKILLS } from './lib/skills.mjs';
import { analyseTickets, fivePointRule } from './lib/integrity.mjs';
import { buildMinutes, applyNaming } from './lib/minutes.mjs';
import { renderExecutiveHtml, executiveTemplate } from './lib/executive.mjs';
import { kpiReplyTemplate } from './lib/leadership.mjs';
import { extractRaidCandidates } from './lib/teams.mjs';
import { buildDashboard } from './lib/dashboard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE = path.resolve(process.env.PHASE_ZERO_WORKSPACE || path.join(ROOT, 'workspace'));
const DIST = path.join(ROOT, 'web', 'dist');
const SKILLS_DIR = path.join(WORKSPACE, 'skills');
const OUTBOX = path.join(WORKSPACE, 'outbox');
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', ...(process.env.PHASE_ZERO_HOSTS || '').split(',').filter(Boolean)]);

const skillDir = (id) => readConfig().skillAliases?.[id] || id;
const readConfig = () => {
  const f = path.join(WORKSPACE, 'config.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
};

// ------------------------------------------------------------------ seeding
/** Imports every folder of .md files under workspace/projects (or demo/) as a project, once. */
export function seed(store, dirs) {
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const folder = path.join(dir, name);
      if (!fs.statSync(folder).isDirectory()) continue;
      if (store.db.projects.some((p) => p.seedKey === name)) continue;
      const files = fs.readdirSync(folder).filter((f) => f.endsWith('.md')).sort();
      if (!files.length) continue;
      const projectMeta = fs.existsSync(path.join(folder, 'project.json'))
        ? JSON.parse(fs.readFileSync(path.join(folder, 'project.json'), 'utf8'))
        : { name };
      const p = store.createProject(projectMeta, 'seed');
      p.seedKey = name;
      for (const f of files) {
        const content = fs.readFileSync(path.join(folder, f), 'utf8');
        const { meta } = parseFrontMatter(content);
        store.createArtifact({
          projectId: p.id,
          key: meta.id || f.replace(/\.md$/, ''),
          title: meta.title || f,
          type: meta.type || 'document',
          gate: meta.gate || '',
          content,
          author: meta.owner || 'seed',
          message: `Imported from ${name}/${f}`,
        });
      }
      store.save();
    }
  }
}

// ------------------------------------------------------------------ http helpers
const send = (res, status, body, headers = {}) => {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isBuf ? 'application/octet-stream' : 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(isBuf || typeof body === 'string' ? body : JSON.stringify(body));
};

const readBody = (req, limit = 5 * 1024 * 1024) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });

const fail = (status, message) => Object.assign(new Error(message), { status });
const safeName = (s) => String(s).replace(/[^\w.-]+/g, '_').slice(0, 80);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
function serveStatic(req, res) {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.normalize(path.join(DIST, url));
  if (file !== DIST && !file.startsWith(DIST + path.sep)) return send(res, 403, { error: 'Forbidden' });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  if (!fs.existsSync(file)) return send(res, 404, 'Front end not built. Run "npm run build" in phase-zero/.', { 'Content-Type': 'text/plain' });
  send(res, 200, fs.readFileSync(file), { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
}

// ------------------------------------------------------------------ views
const current = (store, a) => store.version(a.id, a.currentVersion);
const artifactSummary = (store, a) => {
  const v = current(store, a);
  const reviews = store.reviews(a.id).filter((r) => r.n === a.currentVersion);
  const signed = store.signoffs(a.id).filter((s) => s.n === a.currentVersion && s.decision === 'approved');
  return {
    ...a,
    status: parseFrontMatter(v.content).meta.status || '',
    updatedAt: v.createdAt,
    updatedBy: v.author,
    sha: v.sha,
    reviewScore: reviews.length ? Math.min(...reviews.map((r) => r.score)) : null,
    signedOff: signed.length > 0,
  };
};

function codeFiles() {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.(mjs|js|jsx|css)$/.test(f)) out.push({ path: path.relative(ROOT, p), text: fs.readFileSync(p, 'utf8') });
    }
  };
  walk(path.join(ROOT, 'server'));
  walk(path.join(ROOT, 'web', 'src'));
  return out;
}

// ------------------------------------------------------------------ templates for new artifacts
const TEMPLATES = {
  'kpi-reply': (p, b) => ({ key: `KPI-REPLY-${Date.now().toString(36).toUpperCase()}`, title: `Leadership KPI reply – ${b.scope || p.name}`, type: 'kpi-reply', gate: 'G5', content: kpiReplyTemplate({ scope: b.scope || p.name, asAt: b.asAt || new Date().toISOString().slice(0, 10), pm: b.by || p.owner }) }),
  executive: (p, b) => ({ key: `EXEC-${Date.now().toString(36).toUpperCase()}`, title: 'Executive per-team delivery view', type: 'executive', gate: 'G5', content: executiveTemplate({ pm: b.by || p.owner, teams: (b.teams || '').split('\n').map((t) => t.trim()).filter(Boolean) }) }),
};

// ------------------------------------------------------------------ routes
export function createApp(store) {
  const routes = [];
  const on = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}$`);
    routes.push({ method, re, keys, handler });
  };
  const projectOr404 = (id) => store.project(id) || (() => { throw fail(404, 'Project not found'); })();
  const artifactOr404 = (id) => store.artifact(id) || (() => { throw fail(404, 'Artifact not found'); })();
  const byKey = (projectId, key) => store.artifacts(projectId).find((a) => a.key === key);

  on('GET', '/api/status', () => ({
    liveAi: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    model: MODEL,
    approvalPhrase: APPROVAL_PHRASE,
    ado: readConfig().ado || null,
    workspace: path.relative(ROOT, WORKSPACE) || WORKSPACE,
    skillsAvailable: fs.existsSync(SKILLS_DIR) ? fs.readdirSync(SKILLS_DIR) : [],
  }));

  on('GET', '/api/projects', () => store.db.projects.map((p) => ({ ...p, artifacts: store.artifacts(p.id).length })));

  on('POST', '/api/projects', ({ body }) => {
    if (!body.name?.trim()) throw fail(400, 'Project name is required');
    const p = store.createProject({ name: body.name.trim(), goal: body.goal || '', owner: body.pm || '' }, body.pm || 'pm');
    for (const a of generateArtifacts(body)) store.createArtifact({ projectId: p.id, ...a, author: body.pm || 'generator', message: 'Generated from business goal' });
    return p;
  });

  on('GET', '/api/projects/:id', ({ id }) => {
    const p = projectOr404(id);
    return { ...p, artifacts: store.artifacts(id).map((a) => artifactSummary(store, a)), gates: store.gates(id) };
  });

  on('GET', '/api/projects/:id/dashboard', ({ id }) => {
    projectOr404(id);
    const arts = store.artifacts(id).map((a) => ({ key: a.key, content: current(store, a).content }));
    return buildDashboard(arts);
  });

  on('POST', '/api/projects/:id/gates/:gate', ({ id, gate, body }) => {
    projectOr404(id);
    if (!['open', 'passed', 'blocked', 'waived'].includes(body.status)) throw fail(400, 'Invalid gate status');
    if (!body.by?.trim()) throw fail(400, 'Who is signing the gate?');
    return store.setGate(id, gate, { status: body.status, by: body.by.trim(), note: body.note || '' });
  });

  on('GET', '/api/artifacts/:id', ({ id }) => {
    const a = artifactOr404(id);
    return {
      ...artifactSummary(store, a),
      content: current(store, a).content,
      versions: store.versions(id).map(({ content, ...v }) => v),
      signoffs: store.signoffs(id),
      reviews: store.reviews(id).map(({ findings, ...r }) => ({ ...r, findingCount: findings?.length ?? 0 })),
      reviewers: reviewersFor(a.type).map(({ run, ...r }) => r),
    };
  });

  on('GET', '/api/artifacts/:id/versions/:n', ({ id, n }) => store.version(id, n) || (() => { throw fail(404, 'Version not found'); })());

  on('GET', '/api/artifacts/:id/diff', ({ id, query }) => {
    const a = artifactOr404(id);
    const to = store.version(id, query.get('to') || a.currentVersion);
    const from = store.version(id, query.get('from') || Math.max(1, (to?.n || 1) - 1));
    if (!from || !to) throw fail(404, 'Version not found');
    const ops = diffLines(from.content, to.content);
    return { from: from.n, to: to.n, stats: diffStats(ops), ops };
  });

  on('PUT', '/api/artifacts/:id', ({ id, body }) => {
    artifactOr404(id);
    if (typeof body.content !== 'string') throw fail(400, 'content is required');
    if (!body.message?.trim()) throw fail(400, 'A change message is required (version control)');
    return store.commit(id, { content: body.content, author: body.author || 'pm', message: body.message.trim() });
  });

  on('POST', '/api/artifacts/:id/restore', ({ id, body }) => store.restore(artifactOr404(id).id, body.n, body.author || 'pm'));

  on('POST', '/api/artifacts/:id/signoff', ({ id, body }) => {
    const a = artifactOr404(id);
    if (!body.by?.trim()) throw fail(400, 'Who is signing off?');
    return store.signoff(id, { n: body.n || a.currentVersion, by: body.by.trim(), role: body.role || '', decision: body.decision || 'approved', comment: body.comment || '' });
  });

  on('GET', '/api/artifacts/:id/reviews/:rid', ({ id, rid }) => store.reviews(id).find((r) => r.id === rid) || (() => { throw fail(404, 'Review not found'); })());

  on('POST', '/api/artifacts/:id/review', async ({ id, body }) => {
    const a = artifactOr404(id);
    const v = current(store, a);
    const reviewer = REVIEWERS.find((r) => r.id === body.reviewer);
    if (!reviewer) throw fail(400, 'Unknown reviewer');
    if (body.mode === 'live') {
      if (body.confirm !== true) throw fail(428, 'Live review needs explicit human confirmation');
      const out = await liveReview({ skill: reviewer.skill, skillText: loadSkillText(SKILLS_DIR, skillDir(reviewer.skill)), content: v.content });
      return store.addReview({ artifactId: id, n: v.n, sha: v.sha, reviewer: reviewer.id, skill: reviewer.skill, mode: 'live', by: body.by || 'pm', model: out.model, summary: out.summary, findings: out.findings, score: Math.max(0, 100 - out.findings.length * 5) });
    }
    const out = runReview(reviewer.id, v.content);
    return store.addReview({ artifactId: id, n: v.n, sha: v.sha, mode: 'offline', by: body.by || 'pm', ...out });
  });

  on('POST', '/api/code-review', async ({ body }) => {
    const files = codeFiles();
    if (body.mode === 'live') {
      if (body.confirm !== true) throw fail(428, 'Live review needs explicit human confirmation');
      const skill = body.skill || 'refactor';
      const text = files.map((f) => `// FILE: ${f.path}\n${f.text}`).join('\n\n');
      return { mode: 'live', skill, ...(await liveReview({ skill, skillText: loadSkillText(SKILLS_DIR, skillDir(skill)), content: text })) };
    }
    return { mode: 'offline', ...reviewCode(files) };
  });

  on('GET', '/api/artifacts/:id/export', ({ id, query }) => {
    const a = artifactOr404(id);
    const v = current(store, a);
    const fmt = query.get('format') || 'md';
    const base = `${safeName(a.key)}_v${v.n}`;
    if (fmt === 'md') return { __raw: Buffer.from(v.content), type: 'text/markdown; charset=utf-8', file: `${base}.md` };
    if (fmt === 'docx') return { __raw: markdownToDocx(v.content), type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', file: `${base}.docx` };
    if (fmt === 'xlsx') {
      const sheets = parseTables(v.content).map((t) => ({ name: t.heading.replace(/^[\d.]+\s*/, ''), headers: t.headers, rows: t.rows }));
      return { __raw: tablesToXlsx(sheets), type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', file: `${base}.xlsx` };
    }
    if (fmt === 'html' && a.type === 'executive') {
      return { __raw: Buffer.from(renderExecutiveHtml(v.content, { title: a.title })), type: 'text/html; charset=utf-8', file: `${base}.html` };
    }
    throw fail(400, 'format must be md, docx, xlsx (or html for executive pages)');
  });

  on('POST', '/api/projects/:id/ado/preview', ({ id }) => {
    projectOr404(id);
    const s = byKey(id, 'STORIES');
    if (!s) throw fail(404, 'Project has no STORIES artifact');
    const target = readConfig().ado || { project: 'not configured', areaPath: 'not configured' };
    return { ...buildManifest(current(store, s).content, target), version: s.currentVersion, targetProblems: validateTarget(target) };
  });

  on('POST', '/api/projects/:id/ado/approve', ({ id, body }) => {
    projectOr404(id);
    if (!isApproved(body.phrase)) throw fail(403, 'Approval phrase does not match exactly. Nothing was written.');
    if (!body.by?.trim()) throw fail(400, 'Who is approving?');
    const s = byKey(id, 'STORIES');
    if (!s) throw fail(404, 'Project has no STORIES artifact');
    const target = readConfig().ado;
    const problems = validateTarget(target);
    if (problems.length) throw fail(409, `ADO target in workspace/config.json: ${problems.join('; ')}`);
    const v = current(store, s);
    const manifest = buildManifest(v.content, target);
    const approval = store.addApproval({ projectId: id, by: body.by.trim(), phrase: APPROVAL_PHRASE, artifactKey: s.key, artifactId: s.id, version: v.n, sha: v.sha, items: manifest.items.map((i) => i.ref) });
    fs.mkdirSync(OUTBOX, { recursive: true });
    const stem = path.join(OUTBOX, `ado-${approval.id}`);
    fs.writeFileSync(`${stem}.json`, JSON.stringify({ approval, ...manifest }, null, 2));
    fs.writeFileSync(`${stem}.md`, manifestToMarkdown(manifest, approval));
    return { approval, outbox: path.relative(ROOT, `${stem}.json`), counts: manifest.counts };
  });

  on('POST', '/api/projects/:id/teams', ({ id, body }) => {
    projectOr404(id);
    if (!body.text?.trim()) throw fail(400, 'Paste the Teams chat log');
    const extracted = extractRaidCandidates(body.text);
    store.addTeamsLog({ projectId: id, by: body.by || 'pm', chars: body.text.length, extracted });
    return { extracted };
  });

  on('GET', '/api/skills', () => {
    const counts = {};
    for (const r of REVIEWERS) counts[r.skill] = [...(counts[r.skill] || []), r.name];
    return SKILLS.map((s) => ({ ...s, reviewers: counts[s.id] || [], textAvailable: fs.existsSync(path.join(SKILLS_DIR, skillDir(s.id))) }));
  });

  on('POST', '/api/tickets/analyse', ({ body }) => {
    if (!body.csv?.trim()) throw fail(400, 'Paste or upload the ticket export (CSV)');
    return analyseTickets(body.csv, { groups: body.groups || readConfig().ticketGroups || {}, periodEnd: body.periodEnd || null });
  });

  on('POST', '/api/integrity/five-point', ({ body }) => fivePointRule(body.series || {}));

  on('POST', '/api/projects/:id/minutes', ({ id, body }) => {
    projectOr404(id);
    if (!body.notes?.trim()) throw fail(400, 'Paste the meeting notes');
    const out = buildMinutes(applyNaming(body.notes), body.meta || {});
    if (body.save) {
      const a = store.createArtifact({ projectId: id, key: `MINUTES-${Date.now().toString(36).toUpperCase()}`, title: body.meta?.title || 'Meeting minutes', type: 'minutes', gate: 'G3', content: out.markdown, author: body.by || 'pm', message: 'Minutes from meeting notes' });
      return { ...out, artifactId: a.id };
    }
    return out;
  });

  on('POST', '/api/projects/:id/artifacts', ({ id, body }) => {
    projectOr404(id);
    const tpl = TEMPLATES[body.type];
    if (!tpl) throw fail(400, `Unknown template ${body.type}`);
    const p = store.project(id);
    const a = store.createArtifact({ projectId: id, ...tpl(p, body), author: body.by || 'pm', message: `New ${body.type} from template` });
    return a;
  });

  on('GET', '/api/projects/:id/audit', ({ id }) => store.db.audit.filter((e) => e.projectId === id || store.artifacts(id).some((a) => a.id === e.artifactId)).slice(-200).reverse());

  return async (req, res) => {
    // Local-only tool: refuse DNS-rebinding hosts, and require a custom header on writes so a web page
    // in another tab cannot forge requests (browsers will not send it cross-origin without CORS, which we never grant).
    const host = (req.headers.host || '').replace(/:\d+$/, '');
    if (!ALLOWED_HOSTS.has(host)) return send(res, 421, { error: 'Unknown host' });
    if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-phase-zero'] !== '1') return send(res, 403, { error: 'Missing X-Phase-Zero header' });
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res);
    const route = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
    if (!route) return send(res, 404, { error: 'Not found' });
    try {
      const m = route.re.exec(url.pathname);
      const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
      const out = await route.handler({ ...params, body, query: url.searchParams });
      if (out && out.__raw) return send(res, 200, out.__raw, { 'Content-Type': out.type, 'Content-Disposition': `attachment; filename="${out.file}"` });
      send(res, 200, out);
    } catch (e) {
      send(res, e.status || 500, { error: e.message });
    }
  };
}

// ------------------------------------------------------------------ main
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const store = new Store(path.join(WORKSPACE, 'phase-zero.db.json'));
  seed(store, [path.join(WORKSPACE, 'projects'), path.join(ROOT, 'demo')]);
  const port = Number(process.env.PORT || 4317);
  const host = process.env.HOST || '127.0.0.1';
  http.createServer(createApp(store)).listen(port, host, () => {
    console.log(`Phase Zero running at http://${host}:${port}  (workspace: ${WORKSPACE})`);
  });
}

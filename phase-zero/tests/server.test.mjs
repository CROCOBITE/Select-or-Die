import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

import { crc32, zip } from '../server/lib/zip.mjs';
import { diffLines, diffStats } from '../server/lib/diff.mjs';
import { parseStories, allStories, parseTables, parseFrontMatter } from '../server/lib/md.mjs';
import { Store } from '../server/lib/store.mjs';
import { APPROVAL_PHRASE, isApproved, buildManifest } from '../server/lib/ado.mjs';
import { extractRaidCandidates } from '../server/lib/teams.mjs';
import { runReview, reviewCode, ucp } from '../server/lib/reviews.mjs';
import { generateArtifacts } from '../server/lib/generator.mjs';
import { markdownToDocx } from '../server/lib/docx.mjs';
import { tablesToXlsx } from '../server/lib/xlsx.mjs';
import { redact } from '../server/lib/ai.mjs';
import { buildDashboard, parseRange } from '../server/lib/dashboard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEMO = path.join(ROOT, 'demo', 'sample-clinic-booking');
const demo = (f) => fs.readFileSync(path.join(DEMO, f), 'utf8');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'phase-zero-'));

test('crc32 matches the reference value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('zip writes local headers, central directory and end record', () => {
  const buf = zip([{ name: 'a.txt', data: 'hello' }, { name: 'b/c.xml', data: '<x/>' }]);
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  assert.equal(buf.readUInt32LE(buf.length - 22), 0x06054b50);
  assert.equal(buf.readUInt16LE(buf.length - 12), 2);
});

test('diffLines reports added and removed lines', () => {
  const ops = diffLines('a\nb\nc', 'a\nc\nd');
  assert.deepEqual(diffStats(ops), { added: 1, removed: 1 });
  assert.deepEqual(ops.map((o) => o.op + o.text), [' a', '-b', ' c', '+d']);
});

test('front matter and tables parse', () => {
  const { meta } = parseFrontMatter(demo('04-raid.md'));
  assert.equal(meta.id, 'RAID');
  const actions = parseTables(demo('04-raid.md')).find((t) => /^actions/i.test(t.heading));
  assert.ok(actions.headers.includes('Owner'));
});

test('stories parse into Epic > Feature > Story with acceptance criteria', () => {
  const stories = allStories(parseStories(demo('02-stories.md')));
  assert.equal(stories.length, 4);
  assert.equal(stories[0].acceptance.length, 3);
  assert.match(stories[0].story, /^As a Patient, I want/);
});

test('store keeps append-only versions, skips identical commits and restores', () => {
  const store = new Store(path.join(tmp(), 'db.json'));
  const p = store.createProject({ name: 'T' }, 'tester');
  const a = store.createArtifact({ projectId: p.id, key: 'X', title: 'X', type: 'doc', content: 'v1', author: 'pm' });
  assert.equal(store.commit(a.id, { content: 'v1', author: 'pm' }).unchanged, true);
  store.commit(a.id, { content: 'v2', author: 'pm', message: 'edit' });
  store.restore(a.id, 1, 'pm');
  const versions = store.versions(a.id);
  assert.deepEqual(versions.map((v) => v.content), ['v1', 'v2', 'v1']);
  assert.equal(versions[2].restoredFrom, 1);
  assert.equal(store.gates(p.id).length, 6);
  const reloaded = new Store(store.file);
  assert.equal(reloaded.versions(a.id).length, 3);
});

test('ADO approval accepts only the exact phrase', () => {
  assert.equal(isApproved(APPROVAL_PHRASE), true);
  assert.equal(isApproved(`  ${APPROVAL_PHRASE} `), true);
  assert.equal(isApproved(APPROVAL_PHRASE.toLowerCase()), false);
  assert.equal(isApproved('I agree'), false);
  assert.equal(isApproved(undefined), false);
});

test('ADO manifest builds Epic → Feature → Requirement', () => {
  const m = buildManifest(demo('02-stories.md'), { project: 'P', areaPath: 'P\\A' });
  assert.deepEqual(m.counts, { Epic: 1, Feature: 4, Requirement: 4 });
  assert.match(m.items.find((i) => i.type === 'Requirement').acceptanceCriteria, /^<ol><li>/);
});

test('Teams log extraction finds decisions, actions and owners', () => {
  const log = `[18/10/2026 10:15] Sara Ali: We agreed to use the booking API.
[18/10/2026 10:20] Omar: @Mona Hassan please share the dialer contract by 22/10.
[18/10/2026 10:25] Mona Hassan: The SIT environment is down since morning.`;
  const c = extractRaidCandidates(log);
  assert.deepEqual(c.map((x) => x.kind), ['Decision', 'Action', 'Issue']);
  assert.equal(c[1].owner, 'Mona Hassan');
  assert.equal(c[1].due, '22/10');
  assert.equal(c[0].owner, 'TBC – requires assignment');
});

test('offline reviewers flag generated skeleton stories as not ready', () => {
  const r = runReview('validating-project-scope', demo('02-stories.md'));
  assert.ok(r.findings.some((f) => f.rule === 'Priority'));
  assert.ok(r.score < 100);
  const raid = runReview('pmo-raid', demo('04-raid.md'));
  assert.ok(raid.findings.every((f) => f.severity !== 'blocker'));
});

test('UCP follows the Karner formula', () => {
  const r = ucp(
    { actors: ['complex'], transactions: 3 },
    { technical: Array(13).fill(0), environmental: Array(8).fill(0) }
  );
  assert.equal(r.uaw, 3);
  assert.equal(r.uucw, 5);
  assert.equal(r.tcf, 0.6);
  assert.equal(r.ecf, 1.4);
  assert.equal(r.points, 6.7);
});

test('code review catches secrets and raw HTML', () => {
  const out = reviewCode([{ path: 'web/src/x.jsx', text: 'const apiKey = "sk_live_abcdefghijklmnop";\nel.innerHTML = s;' }]);
  const rules = out.findings.map((f) => f.rule);
  assert.ok(rules.includes('security: hard-coded secret'));
  assert.ok(rules.includes('security: raw HTML'));
});

test('generator marks missing inputs instead of inventing them', () => {
  const arts = generateArtifacts({ name: 'Only a name', capabilities: 'Do a thing' });
  const charter = arts.find((a) => a.key === 'CHARTER').content;
  assert.match(charter, /TBC – requires assignment/);
  assert.match(charter, /not set/);
  assert.equal(arts.length, 6);
});

test('docx and xlsx exports are valid zip packages', () => {
  for (const buf of [markdownToDocx(demo('01-charter.md')), tablesToXlsx([{ name: 'R', headers: ['ID', 'RAG'], rows: [['R-1', 'High']] }])]) {
    assert.equal(buf.readUInt32LE(0), 0x04034b50);
    assert.equal(buf.readUInt32LE(buf.length - 22), 0x06054b50);
  }
});

test('redaction masks e-mails and long numbers before live review', () => {
  assert.equal(redact('mail a.b@x.org id 1234567890 tel +966 55 123 4567'), 'mail [email] id [number] tel [number]');
});

test('dashboard date ranges and lateness', () => {
  const r = parseRange('24 Sep – 09 Oct 2026');
  assert.equal(r.start.toISOString().slice(0, 10), '2026-09-24');
  assert.equal(r.end.toISOString().slice(0, 10), '2026-10-09');
  const d = buildDashboard([{ key: 'RAID', content: demo('04-raid.md') }, { key: 'CHARTER', content: demo('01-charter.md') }], new Date('2026-10-30'));
  assert.equal(d.dueSoon[0].ID, 'AC-01');
});

// ------------------------------------------------------------------ HTTP end-to-end
async function withServer(fn) {
  const ws = tmp();
  process.env.PHASE_ZERO_WORKSPACE = ws;
  fs.writeFileSync(path.join(ws, 'config.json'), JSON.stringify({ ado: { project: 'P', areaPath: 'P\\PMO' } }));
  const { createApp, seed } = await import(`../server/index.mjs?ws=${Date.now()}`);
  const store = new Store(path.join(ws, 'db.json'));
  seed(store, [path.join(ROOT, 'demo')]);
  const server = http.createServer(createApp(store));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body, extra = {}) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-phase-zero': '1', ...extra }, body: body && JSON.stringify(body) });
    const type = res.headers.get('content-type') || '';
    return { status: res.status, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  };
  try {
    await fn(call, ws, base);
  } finally {
    server.close();
  }
}

test('API: edit → version → diff → sign-off → review → export → gated ADO approval', async () => {
  await withServer(async (call, ws, base) => {
    const projects = (await call('GET', '/api/projects')).body;
    assert.equal(projects.length, 1);
    const project = (await call('GET', `/api/projects/${projects[0].id}`)).body;
    const stories = project.artifacts.find((a) => a.key === 'STORIES');

    const art = (await call('GET', `/api/artifacts/${stories.id}`)).body;
    assert.equal((await call('PUT', `/api/artifacts/${stories.id}`, { content: art.content + '\n' })).status, 400, 'message required');
    const put = await call('PUT', `/api/artifacts/${stories.id}`, { content: art.content.replace('Priority:** not set', 'Priority:** Must'), author: 'pm', message: 'Set priority' });
    assert.equal(put.body.version.n, 2);

    const diff = (await call('GET', `/api/artifacts/${stories.id}/diff?from=1&to=2`)).body;
    assert.deepEqual(diff.stats, { added: 1, removed: 1 });

    assert.equal((await call('POST', `/api/artifacts/${stories.id}/signoff`, { by: 'PO', n: 2 })).status, 200);

    const rev = await call('POST', `/api/artifacts/${stories.id}/review`, { reviewer: 'validating-project-scope' });
    assert.equal(rev.status, 200);
    assert.equal(rev.body.n, 2);
    assert.equal((await call('POST', `/api/artifacts/${stories.id}/review`, { reviewer: 'validating-project-scope', mode: 'live' })).status, 428, 'live needs confirmation');

    for (const f of ['md', 'docx', 'xlsx']) assert.equal((await call('GET', `/api/artifacts/${stories.id}/export?format=${f}`)).status, 200);

    const denied = await call('POST', `/api/projects/${project.id}/ado/approve`, { phrase: 'i agree claude add to azur by ado', by: 'PO' });
    assert.equal(denied.status, 403);
    assert.equal(fs.existsSync(path.join(ws, 'outbox')), false, 'nothing written without the phrase');

    const ok = await call('POST', `/api/projects/${project.id}/ado/approve`, { phrase: APPROVAL_PHRASE, by: 'PO' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.approval.version, 2);
    assert.equal(fs.readdirSync(path.join(ws, 'outbox')).length, 2);

    assert.equal((await call('POST', `/api/projects/${project.id}/ado/approve`, { phrase: APPROVAL_PHRASE, by: 'x' }, { 'x-phase-zero': '' })).status, 403, 'writes need the header');
    const rebound = await new Promise((resolve) => {
      const u = new URL(base);
      http.get({ host: u.hostname, port: u.port, path: '/api/projects', headers: { host: 'evil.example' } }, (r) => resolve(r.statusCode));
    });
    assert.equal(rebound, 421, 'DNS rebinding host refused');

    const dash = (await call('GET', `/api/projects/${project.id}/dashboard`)).body;
    assert.equal(dash.backlog.total, 4);
  });
});

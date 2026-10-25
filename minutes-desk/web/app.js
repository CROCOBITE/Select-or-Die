'use strict';
/* Minutes Desk front end. Plain JS, no build step. Every write sends X-Minutes-Desk: 1. */

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const state = { status: null, meeting: null, tab: 'transcript', template: 'recording', user: recall('md-user') };

function recall(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } }
function remember(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } }

async function api(path, { method = 'GET', body, raw } = {}) {
  const headers = method === 'GET' ? {} : { 'X-Minutes-Desk': '1' };
  if (body && !raw) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: raw ? body : body && JSON.stringify(body) });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data.error || data || res.statusText);
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 3500);
}

function fail(e) { toast(e.message || String(e)); }

/* ----------------------------------------------------------------- markdown preview */
function inline(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/(^|\s)_(.+?)_(?=\s|$)/g, '$1<em>$2</em>');
}

function renderMarkdown(md) {
  const out = []; let rows = [];
  const flush = () => {
    if (!rows.length) return;
    const body = rows.filter((r) => !/^\|\s*-/.test(r)).map((r) => r.trim().replace(/^\||\|$/g, '').split('|'));
    out.push('<div class="tw"><table>' + body.map((cells, i) => '<tr>' + cells.map((c) =>
      `<${i ? 'td' : 'th'} dir="auto">${inline(c.trim())}</${i ? 'td' : 'th'}>`).join('') + '</tr>').join('') + '</table></div>');
    rows = [];
  };
  for (const line of (md || '').split('\n')) {
    if (line.trim().startsWith('|')) { rows.push(line); continue; }
    flush();
    if (line.startsWith('# ')) out.push(`<h1 dir="auto">${inline(line.slice(2))}</h1>`);
    else if (line.startsWith('## ')) out.push(`<h2 dir="auto">${inline(line.slice(3))}</h2>`);
    else if (line.startsWith('### ')) out.push(`<h3 dir="auto">${inline(line.slice(4))}</h3>`);
    else if (/^\s*[-*] /.test(line)) out.push(`<div dir="auto">• ${inline(line.replace(/^\s*[-*] /, ''))}</div>`);
    else if (line.trim() === '---') out.push('<hr>');
    else if (line.trim()) out.push(`<p dir="auto">${inline(line)}</p>`);
  }
  flush();
  return out.join('');
}

/* ----------------------------------------------------------------- sidebar */
async function loadMeetings() {
  const list = await api('/api/meetings');
  $('#meetings').innerHTML = list.map((m) => `<li><button data-id="${esc(m.id)}" ${state.meeting?.id === m.id ? 'aria-current="page"' : ''}>
    ${esc(m.title || 'Untitled')}<small>${esc(m.date || '')} · ${esc(m.status || '')}</small></button></li>`).join('')
    || '<li class="muted">No meetings yet.</li>';
}

$('#meetings').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-id]');
  if (b) openMeeting(b.dataset.id).catch(fail);
});
$('#new-meeting').addEventListener('click', () => newMeeting());
document.querySelectorAll('.navitem').forEach((b) => b.addEventListener('click', () => toolView(b.dataset.view).catch(fail)));

function setTheme(t) {
  const cur = document.documentElement.dataset.theme || '';
  const next = cur === t ? '' : t;
  if (next) document.documentElement.dataset.theme = next; else delete document.documentElement.dataset.theme;
  try { next ? localStorage.setItem('md-theme', next) : localStorage.removeItem('md-theme'); } catch { /* storage unavailable */ }
  $('#theme-light').setAttribute('aria-pressed', next === 'light');
  $('#theme-dark').setAttribute('aria-pressed', next === 'dark');
}
$('#theme-light').addEventListener('click', () => setTheme('light'));
$('#theme-dark').addEventListener('click', () => setTheme('dark'));

/* ----------------------------------------------------------------- new meeting */
function options(list, selected) {
  return list.map(([v, l]) => `<option value="${esc(v)}" ${v === selected ? 'selected' : ''}>${esc(l)}</option>`).join('');
}

function newMeeting() {
  state.meeting = null;
  const s = state.status;
  const today = new Date().toISOString().slice(0, 10);
  $('#main').innerHTML = `
  <div class="head"><div><h1>New meeting</h1><p class="muted">Three steps: describe the meeting, add the recording or transcript, then draft the minutes.</p></div></div>
  <form class="card" id="meet-form">
    <div class="grid2">
      <label class="f">Meeting title<input id="f-title" required placeholder="e.g. KSA Claims tickets review"></label>
      <label class="f">Date<input id="f-date" type="date" value="${today}"></label>
      <label class="f">Audience<select id="f-audience"><option value="">General</option>${options(s.audiences.map((a) => [a, a]), '')}</select></label>
      <label class="f">Minutes template<select id="f-template">${options(Object.entries(s.templates), 'recording')}</select></label>
      <label class="f">Chair<input id="f-chair" placeholder="Name of the chair"></label>
      <label class="f">Validator (reviews before issue)<input id="f-validator"></label>
      <label class="f">Attendees (comma-separated)<input id="f-attendees" list="people"></label>
      <label class="f">Distribution (comma-separated)<input id="f-distribution"></label>
      <label class="f">Business objective this meeting serves<input id="f-objective" placeholder="e.g. Cut claim rejections in KSA"></label>
      <label class="f">Classification<select id="f-class">${options([['Internal', 'Internal'], ['Confidential', 'Confidential'], ['Restricted', 'Restricted']], 'Internal')}</select></label>
      <label class="f">Chat period from (WhatsApp/Teams chats)<input id="f-from" type="date"></label>
      <label class="f">Chat period to<input id="f-to" type="date"></label>
    </div>
    <datalist id="people">${s.people.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
    <div class="row" style="margin-top:12px"><button class="btn primary" type="submit">Create meeting</button></div>
  </form>`;
  $('#meet-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const split = (v) => v.split(',').map((x) => x.trim()).filter(Boolean);
    const body = {
      title: $('#f-title').value, date: $('#f-date').value, audience: $('#f-audience').value, template: $('#f-template').value,
      chair: $('#f-chair').value, validator: $('#f-validator').value, attendees: split($('#f-attendees').value),
      distribution: split($('#f-distribution').value), objective: $('#f-objective').value, classification: $('#f-class').value,
      period_from: $('#f-from').value, period_to: $('#f-to').value, author: state.user, by: state.user,
    };
    const m = await api('/api/meetings', { method: 'POST', body }).catch(fail);
    if (m) { await loadMeetings(); openMeeting(m.id); }
  });
}

/* ----------------------------------------------------------------- meeting view */
async function openMeeting(id) {
  state.meeting = await api(`/api/meetings/${id}`);
  state.template = state.meeting.template || 'recording';
  await loadMeetings();
  const hasTranscript = state.meeting.versions.some((v) => v.kind === 'transcript');
  state.tab = hasTranscript ? (state.tab === 'add' ? 'transcript' : state.tab) : 'add';
  renderMeeting();
}

function renderMeeting() {
  const m = state.meeting;
  const tabs = [['add', 'Add recording'], ['transcript', 'Transcript'], ['minutes', 'Minutes'], ['history', 'History']];
  const sign = m.signoff ? `<span class="pill ok">Approved v${m.signoff.v} by ${esc(m.signoff.by)}</span>` : '<span class="pill warn">Not approved</span>';
  $('#main').innerHTML = `
  <div class="head"><div><h1 dir="auto">${esc(m.title || 'Untitled')}</h1>
    <p class="muted">${esc(m.date || '')} · ${esc(m.audience || 'General')} · ${esc(m.status)} ${sign}</p></div>
    <label class="f">Your name (for versions and sign-off)<input id="user" value="${esc(state.user)}"></label></div>
  <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${state.tab === k}">${l}</button>`).join('')}</div>
  <section id="tab"></section>`;
  $('#user').addEventListener('change', (e) => { state.user = e.target.value; remember('md-user', state.user); });
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.tab; renderMeeting(); }));
  ({ add: tabAdd, transcript: tabTranscript, minutes: tabMinutes, history: tabHistory })[state.tab]().catch(fail);
}

/* ---- add recording */
async function tabAdd() {
  const s = state.status;
  const models = s.models.map((x) => [x.id, `${x.label}${x.licence ? '' : ' ⚠'}`]);
  $('#tab').innerHTML = `
  <div class="card">
    <h2>Add a recording or a transcript</h2>
    <p class="muted">Audio or video (mp3, m4a, wav, ogg/opus voice notes, mp4, mov…) is transcribed on this computer.
      Teams transcripts (.vtt, .docx), subtitles (.srt), WhatsApp chat exports and notes (.txt) are imported directly.
      ${s.delete_media ? 'The recording is deleted after transcription (retention setting).' : ''}</p>
    <div class="drop" id="drop"><p><strong>Drop a file here</strong> or</p><input type="file" id="file" aria-label="Choose a file"></div>
    <div id="upload-out"></div>
  </div>
  <div class="card" id="asr" hidden>
    <h2>Transcribe</h2>
    <div class="grid2">
      <label class="f">Saved at playback speed<select id="speed">${options([['1', '1x (normal)'], ['1.5', '1.5x'], ['1.8', '1.8x'], ['2', '2x']], '1')}</select></label>
      <label class="f">Recognition pace<select id="pace">${options([['1', '1x (natural)'], ['0.9', '0.9x'], ['0.8', '0.8x – slower, for fast mixed talk']], '1')}</select></label>
      <label class="f">Language<select id="lang">${options([['ar', 'Arabic (dialect)'], ['auto', 'Mixed Arabic and English – detect per part'], ['en', 'English']], 'ar')}</select></label>
      <label class="f">Engine<select id="engine">${options([['', 'Automatic'], ...s.engines.map((e) => [e, e])], '')}</select></label>
      <label class="f">Model (Whisper engine)<select id="model"><option value="">Automatic for this computer</option>${options(models, '')}</select></label>
    </div>
    <p class="muted">Not sure of the speed? Leave 1x – the tool warns you when the speech looks sped up.
      Pace 0.8x slows the speech further before recognition; compare 1x and 0.8x on one clip in Pilot before using it widely.</p>
    <div class="row"><button class="btn primary" id="go">Transcribe</button></div>
    <div class="bar" style="margin-top:12px"><i id="bar"></i></div><p id="job" class="muted"></p>
  </div>`;
  const drop = $('#drop');
  const send = (file) => upload(file).catch(fail);
  $('#file').addEventListener('change', (e) => e.target.files[0] && send(e.target.files[0]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); e.dataTransfer.files[0] && send(e.dataTransfer.files[0]); });
  if (state.meeting.media.length) showAsr(state.meeting.media[0]);
}

async function upload(file) {
  $('#upload-out').innerHTML = `<p class="muted">Uploading ${esc(file.name)}…</p>`;
  const r = await api(`/api/meetings/${state.meeting.id}/upload?name=${encodeURIComponent(file.name)}&by=${encodeURIComponent(state.user)}`,
    { method: 'POST', body: file, raw: true });
  if (r.kind === 'transcript') {
    toast(`Imported ${r.segments} lines`);
    state.tab = 'transcript';
    return openMeeting(state.meeting.id);
  }
  const mins = r.probe.duration ? `${Math.round(r.probe.duration / 60)} min` : 'length unknown';
  $('#upload-out').innerHTML = `<p>Saved <strong>${esc(r.file)}</strong> (${mins}${r.probe.audio === false ? ', no audio track found' : ''}).</p>`;
  showAsr(r.file);
}

function showAsr() {
  $('#asr').hidden = false;
  $('#go').onclick = async () => {
    $('#go').disabled = true;
    const job = await api(`/api/meetings/${state.meeting.id}/transcribe`, {
      method: 'POST', body: { engine: $('#engine').value, model: $('#model').value, speed: $('#speed').value, pace: $('#pace').value, language: $('#lang').value, by: state.user },
    }).catch((e) => { $('#go').disabled = false; fail(e); });
    if (job) poll(job.id);
  };
}

async function poll(id) {
  const job = await api(`/api/jobs/${id}`);
  $('#bar').style.width = `${job.progress}%`;
  $('#job').textContent = job.message;
  if (job.status === 'running') return setTimeout(() => poll(id).catch(fail), 1500);
  if (job.status === 'failed') { $('#job').classList.add('err'); $('#go').disabled = false; return; }
  if (job.hint) toast(job.hint);
  state.tab = 'transcript';
  openMeeting(state.meeting.id);
}

/* ---- transcript */
async function tabTranscript() {
  const t = await api(`/api/meetings/${state.meeting.id}/transcript`);
  const flagged = t.segments.filter((s) => (s.flags || []).some((f) => f.code !== 'verify-number')).length;
  $('#tab').innerHTML = `
  <div class="card">
    <div class="row" style="justify-content:space-between">
      <div><h2>Transcript</h2><p class="muted">${esc(t.kind || t.engine)} ${t.model ? '· ' + esc(t.model) : ''} · ${t.segments.length} segments ·
        <span class="pill warn">${flagged} flagged</span>${t.speed && t.speed !== 1 ? ` · restored from ${t.speed}x` : ''}</p>
        ${t.speed_hint ? `<p class="err">${esc(t.speed_hint)}</p>` : ''}</div>
      <div class="row"><input id="tmsg" placeholder="What did you correct?" style="width:260px"><button class="btn primary" id="tsave">Save corrections</button></div>
    </div>
    <p class="muted">Click any text to correct it. Highlighted rows were flagged: check them against the recording before they are minuted.</p>
    <div class="tw"><table><thead><tr><th>When</th><th>Speaker</th><th>Text</th><th>Flags</th></tr></thead><tbody>
    ${t.segments.map((s, i) => {
      const f = (s.flags || []).filter((x) => x.code !== 'verify-number');
      return `<tr class="${f.length ? 'flagged' : ''}"><td class="ref">${esc(ref(s))}</td>
      <td class="who" contenteditable="true" data-i="${i}" data-k="speaker" dir="auto">${esc(s.speaker || '')}</td>
      <td contenteditable="true" data-i="${i}" data-k="text" dir="auto">${esc(s.text)}</td>
      <td>${(s.flags || []).map((x) => `<span class="pill ${x.code === 'verify-number' ? '' : 'warn'}" title="${esc(x.note)}">${esc(x.code)}</span>`).join(' ')}</td></tr>`;
    }).join('')}</tbody></table></div>
  </div>`;
  $('#tsave').onclick = async () => {
    document.querySelectorAll('[data-i]').forEach((td) => { t.segments[+td.dataset.i][td.dataset.k] = td.textContent.trim(); });
    await api(`/api/meetings/${state.meeting.id}/transcript`, { method: 'POST', body: { segments: t.segments, message: $('#tmsg').value, by: state.user } });
    toast('Transcript saved as a new version');
    openMeeting(state.meeting.id);
  };
}

function ref(s) {
  if (s.start !== null && s.start !== undefined) {
    const x = Math.floor(s.start); const h = Math.floor(x / 3600); const mm = String(Math.floor((x % 3600) / 60)).padStart(2, '0'); const ss = String(x % 60).padStart(2, '0');
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }
  return s.at ? s.at.replace('T', ' ') : (s.line ? `line ${s.line}` : '');
}

/* ---- minutes */
async function tabMinutes() {
  const saved = await api(`/api/meetings/${state.meeting.id}/minutes`);
  $('#tab').innerHTML = `
  <div class="card">
    <div class="row" style="justify-content:space-between">
      <div class="row"><label class="f">Template<select id="tpl">${options(Object.entries(state.status.templates), state.template)}</select></label></div>
      <div class="row">
        <button class="btn" id="offline">Offline draft</button>
        <button class="btn" id="claude">Draft with Claude…</button>
      </div>
    </div>
    <div id="confirm"></div>
  </div>
  <div class="card" id="score-card" hidden><h2>Pre-issue checks</h2><div id="score"></div></div>
  <div class="split">
    <div class="card"><h2>Edit</h2><textarea class="editor" id="md" dir="auto" aria-label="Minutes in Markdown">${esc(saved.markdown || '')}</textarea>
      <div class="row" style="margin-top:8px"><input id="msg" placeholder="What changed? (required)"><button class="btn primary" id="save">Save version</button></div></div>
    <div class="card preview" id="pv"><p class="muted">Draft the minutes to see them here.</p></div>
  </div>
  <div class="card"><h2>Approve and export</h2>
    <div class="row"><input id="approver" placeholder="Approver name" style="width:220px" value="${esc(state.meeting.chair || '')}">
      <button class="btn" id="sign">Record approval of the saved version</button></div>
    <div class="row" style="margin-top:10px">
      ${['docx:Word (.docx)', 'md:Markdown', 'txt:Teams / e-mail text', 'mom:DevOps “MOM:” line'].map((x) => { const [f, l] = x.split(':'); return `<a class="btn" href="/api/meetings/${state.meeting.id}/export?format=${f}&by=${encodeURIComponent(state.user)}">${l}</a>`; }).join('')}
    </div>
    <p class="muted">Exports use the saved version. DevOps is never written to from here; paste the “MOM:” line into the meeting task yourself.</p></div>`;
  const md = $('#md');
  const refresh = () => { $('#pv').innerHTML = renderMarkdown(md.value); };
  md.addEventListener('input', refresh);
  if (saved.markdown) { refresh(); showChecks(saved.checks); }
  $('#tpl').onchange = (e) => { state.template = e.target.value; };
  $('#offline').onclick = async () => {
    const r = await api(`/api/meetings/${state.meeting.id}/minutes/offline`, { method: 'POST', body: { template: state.template, save: true, by: state.user } });
    md.value = r.markdown; refresh(); showChecks(r.checks); toast('Offline draft saved as a new version');
  };
  $('#claude').onclick = () => claudeConfirm().catch(fail);
  $('#save').onclick = async () => {
    const r = await api(`/api/meetings/${state.meeting.id}/minutes`, { method: 'POST', body: { markdown: md.value, message: $('#msg').value, by: state.user } });
    showChecks(r.checks); toast(`Saved v${r.version.v}`);
  };
  $('#sign').onclick = async () => {
    const r = await api(`/api/meetings/${state.meeting.id}/signoff`, { method: 'POST', body: { by: $('#approver').value, role: 'Chair' } });
    toast(`Approval recorded on v${r.v}`); openMeeting(state.meeting.id);
  };
}

function showChecks(c) {
  if (!c) return;
  $('#score-card').hidden = false;
  const cls = { Strong: 'ok', Partial: 'warn', Weak: 'bad' };
  $('#score').innerHTML = `<p>Score <strong>${c.score}</strong> / 100 · ${c.findings.length} findings</p>
    <div class="score">${c.scorecard.map((s) => `<div><b>${esc(s.standard)}</b><span class="pill ${cls[s.level]}">${s.level}</span>
      <div class="muted" style="font-size:12px">${esc(s.rule)}</div></div>`).join('')}</div>
    <details style="margin-top:10px"><summary>Findings</summary><ul>${c.findings.slice(0, 200).map((f) =>
      `<li><span class="pill ${f.level === 'major' ? 'bad' : f.level === 'minor' ? 'warn' : ''}">${f.level}</span> ${esc(f.text)}</li>`).join('')}</ul></details>`;
}

async function claudeConfirm() {
  const p = await api(`/api/meetings/${state.meeting.id}/claude/preview`, { method: 'POST', body: { template: state.template } });
  const masked = Object.entries(p.redactions).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing matched';
  $('#confirm').innerHTML = `<div class="confirm">
    <strong>Send this meeting to Claude (${esc(p.model)})?</strong>
    <p>The transcript and meeting details below leave this computer. Masked first: ${esc(masked)}. About ${p.approx_tokens.toLocaleString()} tokens.
      Names of people and anything said about patients are <em>not</em> masked – do not send clinical case discussions.</p>
    <details><summary>See exactly what will be sent</summary><pre dir="auto">${esc(p.user)}</pre></details>
    <label class="row"><input type="checkbox" id="ok" style="width:auto"> I have checked the content and confirm sending it.</label>
    <div class="row"><button class="btn primary" id="send" disabled>Send and draft</button><button class="btn" id="cancel">Cancel</button></div></div>`;
  $('#ok').onchange = (e) => { $('#send').disabled = !e.target.checked; };
  $('#cancel').onclick = () => { $('#confirm').innerHTML = ''; };
  $('#send').onclick = async () => {
    $('#send').disabled = true; $('#send').textContent = 'Drafting… this can take a few minutes';
    try {
      const r = await api(`/api/meetings/${state.meeting.id}/claude/draft`, { method: 'POST', body: { template: state.template, sha: p.sha, confirm: true, by: state.user } });
      $('#md').value = r.markdown; $('#pv').innerHTML = renderMarkdown(r.markdown); showChecks(r.checks);
      $('#confirm').innerHTML = ''; toast(`Claude draft saved as v${r.version.v}`);
    } catch (e) { fail(e); $('#send').disabled = false; $('#send').textContent = 'Send and draft'; }
  };
}

/* ---- history */
async function tabHistory() {
  const audit = await api(`/api/audit?meeting=${state.meeting.id}`);
  $('#tab').innerHTML = `<div class="card"><h2>Versions</h2><div class="tw"><table><thead><tr><th>What</th><th>Version</th><th>When</th><th>Who</th><th>Message</th><th>sha</th></tr></thead><tbody>
    ${state.meeting.versions.slice().reverse().map((v) => `<tr><td>${v.kind}</td><td>v${v.v}</td><td>${esc(v.at)}</td><td>${esc(v.by)}</td><td dir="auto">${esc(v.message)}</td><td class="ref">${v.sha}</td></tr>`).join('')}
    </tbody></table></div></div>
    <div class="card"><h2>Audit</h2><div class="tw"><table><thead><tr><th>When</th><th>Action</th><th>Who</th><th>Detail</th></tr></thead><tbody>
    ${audit.map((a) => `<tr><td class="ref">${esc(a.at)}</td><td>${esc(a.action)}</td><td>${esc(a.by)}</td><td dir="auto">${esc(a.detail)}</td></tr>`).join('')}</tbody></table></div>
    ${state.meeting.media.length ? '<div class="row" style="margin-top:10px"><button class="btn" id="del">Delete the recording now</button></div>' : ''}</div>`;
  const del = $('#del');
  if (del) del.onclick = async () => { await api(`/api/meetings/${state.meeting.id}/media/delete`, { method: 'POST', body: { by: state.user } }); toast('Recording deleted'); openMeeting(state.meeting.id); };
}

/* ----------------------------------------------------------------- tools */
async function toolView(view) {
  state.meeting = null;
  await loadMeetings();
  document.querySelectorAll('.navitem').forEach((b) => b.toggleAttribute('aria-current', b.dataset.view === view));
  if (view === 'doctor') return doctorView();
  if (view === 'skills') return skillsView();
  if (view === 'pilot') return pilotView();
  return auditView();
}

async function doctorView() {
  const d = await api('/api/doctor');
  $('#main').innerHTML = `<div class="head"><div><h1>This computer</h1><p class="muted">Device: ${esc(d.device)} · Python ${esc(d.python)} · ${esc(d.platform)} · engines: ${esc(d.engines.join(', ') || 'none')}</p></div></div>
  <div class="card"><div class="tw"><table><thead><tr><th>Check</th><th>Result</th><th>What to do</th></tr></thead><tbody>
  ${d.checks.map((c) => `<tr><td>${esc(c.name)}</td><td><span class="pill ${c.ok ? 'ok' : 'warn'}">${c.ok ? 'OK' : 'Missing'}</span></td><td>${esc(c.fix)}</td></tr>`).join('')}</tbody></table></div></div>`;
}

async function skillsView() {
  const s = await api('/api/skills');
  $('#main').innerHTML = `<div class="head"><div><h1>Skills checklist</h1><p class="muted">What each skill gives this tool, where it stops, and where it is coded.</p></div></div>
  ${s.applied.map((k) => `<div class="card"><h2>${esc(k.name)} ${k.text_available ? '<span class="pill ok">skill text loaded</span>' : ''}</h2>
    <div class="grid2"><div><h3>Benefits</h3><ul>${k.benefits.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div>
    <div><h3>Boundaries</h3><ul>${k.boundaries.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div></div>
    <p class="muted">Coded in: ${esc(k.coded.join(' · '))}</p></div>`).join('')}
  <div class="card"><h2>Not applied</h2><ul>${Object.entries(s.not_applied).map(([k, v]) => `<li><strong>${esc(k)}</strong> – ${esc(v)}</li>`).join('')}</ul></div>`;
}

async function pilotView() {
  const list = await api('/api/meetings');
  $('#main').innerHTML = `<div class="head"><div><h1>Pilot – measure accuracy</h1>
    <p class="muted">Before trusting a model, type what was really said in a 5–10 minute clip and compare. Word error rate (WER) under about 25% is workable for minutes; above 40%, use another model or the Teams transcript.</p></div></div>
  <div class="card"><div class="grid2"><label class="f">Meeting with the machine transcript<select id="pm">${options(list.map((m) => [m.id, m.title || m.id]), '')}</select></label></div>
    <label class="f" style="margin-top:10px">What was really said (reference)<textarea id="ref" rows="8" dir="auto"></textarea></label>
    <div class="row" style="margin-top:10px"><button class="btn primary" id="measure">Measure</button></div><div id="wer"></div></div>`;
  $('#measure').onclick = async () => {
    const r = await api('/api/wer', { method: 'POST', body: { reference: $('#ref').value, meeting: $('#pm').value } });
    $('#wer').innerHTML = `<p>WER <strong>${(r.wer * 100).toFixed(1)}%</strong> · CER ${(r.cer * 100).toFixed(1)}% · ${r.ref_words} reference words, ${r.hyp_words} transcribed</p>`;
  };
}

async function auditView() {
  const a = await api('/api/audit');
  $('#main').innerHTML = `<div class="head"><div><h1>Audit log</h1><p class="muted">Every upload, transcription, Claude send, save, approval, export and deletion.</p></div></div>
  <div class="card"><div class="tw"><table><thead><tr><th>When</th><th>Action</th><th>Who</th><th>Meeting</th><th>Detail</th></tr></thead><tbody>
  ${a.map((x) => `<tr><td class="ref">${esc(x.at)}</td><td>${esc(x.action)}</td><td>${esc(x.by)}</td><td class="ref">${esc(x.meeting)}</td><td dir="auto">${esc(x.detail)}</td></tr>`).join('')}</tbody></table></div></div>`;
}

/* ----------------------------------------------------------------- boot */
(async () => {
  try {
    state.status = await api('/api/status');
    setTheme(document.documentElement.dataset.theme || ''); setTheme(document.documentElement.dataset.theme || '');
    await loadMeetings();
    newMeeting();
  } catch (e) { $('#main').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
})();

// Executive per-team page: one panel per team, business outcomes only, a mechanism diagram each.
// Source format (markdown):
//   ## Team: Scrum 1
//   - **Headline:** …            - **Owns:** …
//   - **Before:** … (caption: what the situation was)
//   - **Mechanism:** step → step → *changed step* → step   (the *starred* step is what changed)
//   - **Outcomes:** (numbered list, 3–5, bold-led)
//   - **Numbers:** Committed 22 · Delivered 20 · Completion 91% · Screens modernised 6
//   - **Flag:** decision | Text   (or "worth knowing | Text"; omit when not needed)
import { plain, escapeXml as esc } from './md.mjs';

const finding = (severity, rule, message, where = '') => ({ severity, rule, message, where });
const field = (block, name) => (new RegExp(`^- \\*\\*${name}:\\*\\*\\s*(.*)$`, 'mi').exec(block)?.[1] || '').trim();

export function parseExecutive(text) {
  const parts = text.split(/^## Team:\s*/m).slice(1);
  return parts.map((p) => {
    const [nameLine, ...rest] = p.split('\n');
    const block = rest.join('\n');
    const outcomes = [];
    const oi = block.search(/- \*\*Outcomes:\*\*/i);
    if (oi >= 0) for (const l of block.slice(oi).split('\n').slice(1)) {
      const m = /^\s+\d+\.\s+(.*)/.exec(l);
      if (m) outcomes.push(m[1].trim());
      else if (/^- \*\*/.test(l)) break;
    }
    const numbers = field(block, 'Numbers').split('·').map((s) => s.trim()).filter(Boolean).map((s) => {
      const m = /^(.*?)\s+([\d.,]+%?)$/.exec(s);
      return m ? { label: m[1], value: m[2] } : { label: s, value: '' };
    });
    const flagRaw = field(block, 'Flag');
    const [flagKind, ...flagText] = flagRaw.split('|');
    return {
      team: nameLine.trim(),
      headline: field(block, 'Headline'),
      owns: field(block, 'Owns'),
      before: field(block, 'Before'),
      mechanism: field(block, 'Mechanism').split(/\s*→\s*/).filter(Boolean).map((s) => ({ text: s.replace(/^\*|\*$/g, '').trim(), changed: /^\*.*\*$/.test(s.trim()) })),
      outcomes,
      numbers,
      flag: flagRaw ? { kind: /decision/i.test(flagKind) ? 'decision' : 'note', text: flagText.join('|').trim() } : null,
    };
  });
}

// Vocabulary that must not reach an executive reader.
const ENGINEERING = [
  [/\[(DTC|FE|Revamp|CR)\]/i, 'bracketed work prefixes'],
  [/#\d{3,}/, 'work item IDs'],
  [/\b(backlog|sprint hygiene|iteration path|baseline|story points?|weight)\b/i, 'delivery jargon'],
  [/\b(Function Head Assignment|Live Bug Fixing|Resolve Technical Debts|Product Backlog Item)\b/, 'story types'],
  [/\b[A-Z][a-z]+_[a-z]+\b|\b[A-Z][a-z]+[A-Z][a-z]+(ment|ance|ing)\b/, 'module field values'],
  [/\.NET\s?\d+|\bupgraded? to\b/i, 'platform version talk (say what risk it removes)'],
];

export function reviewExecutive(text) {
  const findings = [];
  const teams = parseExecutive(text);
  if (!teams.length) return { findings: [finding('blocker', 'Format', 'No "## Team: …" panels found.')] };
  for (const t of teams) {
    if (!t.headline) findings.push(finding('major', 'Headline', 'No business headline.', t.team));
    if (!t.owns) findings.push(finding('minor', 'Owns', 'No one-line ownership in business terms.', t.team));
    if (t.mechanism.length < 2) findings.push(finding('major', 'Mechanism', 'Mechanism needs at least two steps.', t.team));
    if (!t.mechanism.some((s) => s.changed)) findings.push(finding('major', 'Mechanism', 'Mark the step that changed this week with *asterisks*.', t.team));
    if (!t.before) findings.push(finding('minor', 'Before-state', 'Say what was wrong before; the before-state is what makes the after-state land.', t.team));
    if (t.outcomes.length < 3 || t.outcomes.length > 5) findings.push(finding('major', 'Outcomes', `${t.outcomes.length} outcomes; use 3–5.`, t.team));
    if (t.numbers.length !== 4) findings.push(finding('major', 'Number strip', `${t.numbers.length} numbers; the strip is exactly four cells (Committed · Delivered · Completion · one domain metric).`, t.team));
    if (t.flag && !t.flag.text) findings.push(finding('minor', 'Flag', 'Flag without text. No flag is better than a filler flag.', t.team));
  }
  text.split('\n').forEach((l, i) => {
    for (const [re, what] of ENGINEERING) if (re.test(l)) findings.push(finding('major', 'Executive vocabulary', `Contains ${what}: “${plain(l).trim().slice(0, 70)}”.`, `line ${i + 1}`));
  });
  if (!/what ["“]?completion["”]? means|completion (means|is)/i.test(text)) findings.push(finding('minor', 'Completion footnote', 'Close with one footnote explaining what "completion" means.'));
  return { findings };
}

function mechanismSvg(steps, caption) {
  const W = 760;
  const n = steps.length;
  const gap = 34;
  const bw = Math.min(170, (W - gap * (n - 1) - 20) / n);
  const H = caption ? 122 : 96;
  const x0 = (W - (bw * n + gap * (n - 1))) / 2;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(steps.map((x) => x.text).join(' then '))}"><defs><marker id="ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="currentColor"/></marker></defs>`;
  steps.forEach((st, i) => {
    const x = x0 + i * (bw + gap);
    s += `<g class="${st.changed ? 'chg' : 'std'}"><rect x="${x}" y="16" width="${bw}" height="52" rx="10"/><foreignObject x="${x + 6}" y="18" width="${bw - 12}" height="48"><div xmlns="http://www.w3.org/1999/xhtml" class="lab">${esc(st.text)}</div></foreignObject></g>`;
    if (i < n - 1) s += `<line class="arr${steps[i + 1].changed || st.changed ? ' chg' : ''}" x1="${x + bw + 2}" y1="42" x2="${x + bw + gap - 4}" y2="42" marker-end="url(#ah)"/>`;
  });
  if (caption) s += `<text x="${W / 2}" y="${H - 14}" text-anchor="middle" class="cap">Before: ${esc(caption)}</text>`;
  return `${s}</svg>`;
}

const CSS = `:root{--bg:#f4f6fa;--surface:#fff;--ink:#131a2a;--ink2:#46516a;--line:#d8dee8;--band:#1f3864;--band-ink:#fff;--cell:#dce6f1;--acc:#c0511b;--warn:#fbc08a;--warn-ink:#3a2410;--hi:#c0511b;--hi-ink:#fff;--disp:'Source Serif 4',Georgia,serif;--body:'IBM Plex Sans',system-ui,sans-serif;--mono:'IBM Plex Mono',ui-monospace,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#10141c;--surface:#181d28;--ink:#eef1f7;--ink2:#bcc4d6;--line:#2f3747;--band:#24406e;--cell:#1f2a3d;--acc:#e8954a;--warn:#e8954a;--hi:#d95926;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#10141c;--surface:#181d28;--ink:#eef1f7;--ink2:#bcc4d6;--line:#2f3747;--band:#24406e;--cell:#1f2a3d;--acc:#e8954a;--warn:#e8954a;--hi:#d95926;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 var(--body)}
.wrap{max-width:980px;margin:0 auto;padding:24px max(16px,env(safe-area-inset-left,0px)) 48px;display:grid;gap:22px}
.band{background:var(--band);color:var(--band-ink);border-radius:12px;padding:20px 22px}.band h1{font:600 28px/1.2 var(--disp);margin:0 0 4px}.band p{margin:0;opacity:.85}
.team{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:18px 20px;display:grid;gap:10px;break-inside:avoid}
.tag{font:600 12px var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--ink2)}
.team h2{font:600 21px/1.3 var(--disp);margin:0;text-wrap:balance}.owns{margin:0;color:var(--ink2)}
figure{margin:0;color:var(--ink2)}figure svg{width:100%;height:auto}figcaption{font-size:13px;color:var(--ink2)}
.std rect{fill:none;stroke:currentColor;stroke-width:1.5}.chg rect{fill:none;stroke:var(--acc);stroke-width:3}
.lab{font:13px/1.25 var(--body);color:var(--ink);display:flex;align-items:center;justify-content:center;text-align:center;height:48px}
.chg .lab{font-weight:600}.arr{stroke:currentColor;stroke-width:1.5;color:var(--ink2)}.arr.chg{stroke:var(--acc);stroke-width:3;color:var(--acc)}
.cap{fill:var(--ink2);font:12px var(--body);font-style:italic}
ol{margin:0;padding-left:20px;display:grid;gap:4px}
.strip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.strip div{background:var(--cell);border-radius:8px;padding:8px 10px}.strip b{display:block;font:600 20px var(--mono)}.strip span{font-size:12px;color:var(--ink2)}
@media(max-width:560px){.strip{grid-template-columns:repeat(2,minmax(0,1fr))}}
.flag{border-radius:8px;padding:10px 12px}.flag.decision{background:var(--hi);color:var(--hi-ink)}.flag.note{background:var(--warn);color:var(--warn-ink)}
.foot{font-size:13px;color:var(--ink2)}`;

export function renderExecutiveHtml(text, { title = 'Executive delivery view', period = '' } = {}) {
  const teams = parseExecutive(text);
  const foot = /^>\s*(.*completion.*)$/im.exec(text)?.[1] || 'Completion = delivered ÷ committed for the period.';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@600&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Mono:wght@600&display=swap"><style>${CSS}</style></head><body><main class="wrap">
<header class="band"><h1>${esc(title)}</h1>${period ? `<p>${esc(period)}</p>` : ''}</header>
${teams.map((t) => `<section class="team"><span class="tag">${esc(t.team)}</span><h2>${esc(t.headline)}</h2>${t.owns ? `<p class="owns">${esc(t.owns)}</p>` : ''}
<figure>${t.mechanism.length ? mechanismSvg(t.mechanism, t.before) : ''}<figcaption>${esc(t.mechanism.filter((s) => s.changed).map((s) => s.text).join(', ') || '')}</figcaption></figure>
<ol>${t.outcomes.map((o) => `<li>${esc(plain(o)).replace(/^([^.:–]+[.:–])/, '<b>$1</b>')}</li>`).join('')}</ol>
<div class="strip">${t.numbers.map((n) => `<div><b>${esc(n.value)}</b><span>${esc(n.label)}</span></div>`).join('')}</div>
${t.flag ? `<div class="flag ${t.flag.kind}"><b>${t.flag.kind === 'decision' ? 'Decision needed.' : 'Worth knowing.'}</b> ${esc(t.flag.text)}</div>` : ''}</section>`).join('\n')}
<p class="foot">${esc(foot)}</p></main></body></html>`;
}

export function executiveTemplate({ pm = 'TBC – requires assignment', teams = [] } = {}) {
  const list = teams.length ? teams : ['Team 1'];
  return `---
id: EXEC
title: Executive per-team delivery view
type: executive
gate: G5
owner: ${pm}
status: Draft
---

# Executive per-team delivery view

${list.map((t) => `## Team: ${t}
- **Headline:** not set – what changed for the business, in one sentence a director would repeat
- **Owns:** not set – what the team owns, in business terms
- **Before:** not set – what the situation was before this week
- **Mechanism:** step → *what changed* → step
- **Outcomes:**
  1. **not set.** what someone can now do
  2. **not set.** what someone can now do
  3. **not set.** what someone can now do
- **Numbers:** Committed 0 · Delivered 0 · Completion 0% · Domain metric 0
`).join('\n')}
> What "completion" means: delivered ÷ committed for the period. It measures the plan's realism as much as the team.
`;
}

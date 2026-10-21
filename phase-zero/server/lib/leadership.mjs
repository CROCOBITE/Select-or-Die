// Leadership reply in the two-table KPI shape: Table A = KPIs moved (was → now, dated),
// Table B = gaps (today, target, due date, one named person). Optional "What I need" block.
import { parseTables, plain } from './md.mjs';
import { kpiRuleSweep } from './integrity.mjs';

const finding = (severity, rule, message, where = '') => ({ severity, rule, message, where });
const hasNumber = (s) => /\d/.test(s);
const isDate = (s) => /\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/i.test(s);
const VAGUE_DUE = /\b(ongoing|next sprint|when .* completes|asap|tbd|tbc|soon)\b/i;
const NOT_A_PERSON = /\b(team|pmo|department|dept|tbc|tbd|owner|lead|manager|director|committee|scrum|squad|unit|office|it|qa|dt)\b/i;

const col = (t, re) => t.headers.findIndex((h) => re.test(plain(h)));

export function reviewKpiReply(text) {
  const findings = [];
  const tables = parseTables(text);
  const A = tables.find((t) => col(t, /^was$/i) >= 0 && col(t, /^now/i) >= 0);
  const B = tables.find((t) => col(t, /^owner$/i) >= 0 && col(t, /^due$/i) >= 0 && col(t, /^target$/i) >= 0);

  if (!A) findings.push(finding('blocker', 'Table A', 'No Table A (KPI | Was | Now (date)).'));
  else {
    const was = col(A, /^was$/i);
    const now = col(A, /^now/i);
    if (!isDate(plain(A.headers[now]))) findings.push(finding('major', 'Table A', 'Put the as-at date in the "Now" column header, e.g. "Now (21 Oct)".'));
    if (A.rows.length < 4 || A.rows.length > 6) findings.push(finding('minor', 'Table A', `${A.rows.length} rows; 4–6 keep it readable.`));
    for (const r of A.rows) {
      const id = plain(r[0] || '');
      if (!hasNumber(plain(r[was] || ''))) findings.push(finding('major', 'Table A was/now', '"Was" has no figure. "Improved" without a prior number is not a KPI movement.', id));
      if (!hasNumber(plain(r[now] || ''))) findings.push(finding('major', 'Table A was/now', '"Now" has no figure.', id));
    }
  }

  if (!B) findings.push(finding('blocker', 'Table B', 'No Table B (KPI | Today | Target | Due | Owner).'));
  else {
    const today = col(B, /^today/i);
    const due = col(B, /^due$/i);
    const owner = col(B, /^owner$/i);
    if (B.rows.length < 6 || B.rows.length > 8) findings.push(finding('minor', 'Table B', `${B.rows.length} rows; 6–8 is the working range.`));
    for (const r of B.rows) {
      const id = plain(r[0] || '');
      const o = plain(r[owner] || '').trim();
      const d = plain(r[due] || '');
      if (!o) findings.push(finding('blocker', 'Table B owner', 'No owner.', id));
      else if (NOT_A_PERSON.test(o) || o.split(/\s+/).length < 2) findings.push(finding('major', 'Table B owner', `Owner "${o}" is not one named person. If nobody owns it, move it to "What I need" as an ask.`, id));
      if (!isDate(d) || VAGUE_DUE.test(d)) findings.push(finding('major', 'Table B due', `Due "${d || '–'}" is not a date.`, id));
      if (today >= 0 && !hasNumber(plain(r[today] || ''))) findings.push(finding('major', 'Table B today', 'Today has no measurement, so the gap is not shown to be real.', id));
    }
  }

  const tail = text.split(/\n/).map((l) => l.trim()).filter(Boolean).slice(-3).join(' ');
  if (/\b(thank you|thanks|happy to discuss|let me know|looking forward|regards)\b/i.test(tail)) findings.push(finding('minor', 'Close with nothing', 'Closing pleasantry after the tables. The tables are the reply.'));
  const need = /^#{1,4}\s+what i need/im.test(text);
  if (need) {
    const asks = parseTables(text.split(/^#{1,4}\s+what i need/im)[1] || '')[0];
    if (asks && asks.rows.some((r) => !r.some((c) => isDate(plain(c))))) findings.push(finding('minor', 'What I need', 'Every ask names who decides and by when.'));
  }
  findings.push(...kpiRuleSweep(text));
  findings.push(finding('info', 'Honest-number test', 'Before sending, find the line that costs you something (a measured figure that contradicts a plan or a claim). If there is none, the measurement probably has not been done.'));
  return { findings };
}

export function kpiReplyTemplate({ scope = 'not set', asAt = 'date', pm = 'TBC – requires assignment' } = {}) {
  return `---
id: KPI-REPLY
title: Leadership KPI reply – ${scope}
type: kpi-reply
gate: G5
owner: ${pm}
status: Draft
---

# Leadership KPI reply – ${scope}

Below is the KPI view for ${scope}. Each line is either a KPI we have moved, or a gap with a target, a due date and an owner.

### Table A – KPIs improved

| # | KPI | Was | Now (${asAt}) |
|---|---|---|---|
| A1 | not set | not set | not set |

### Table B – Gaps: target, due date, owner

| # | KPI | Today | Target | Due | Owner |
|---|---|---|---|---|---|
| B1 | not set | not set | not set | not set | not set |

### What I need

| # | Ask | Who decides | By |
|---|---|---|---|
| N1 | not set | not set | not set |
`;
}

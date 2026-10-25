// Meeting notes → minutes. Keeps the author's own wording ("Discussion – as written"), separates the PMO's
// own judgement from team decisions, flags QA-vs-dev disagreement as CONFLICT, and drafts the
// Root cause / Solution / Deadline block per item. Also enforces the naming rule for ticket reviews.
import { extractRaidCandidates } from './teams.mjs';

// Ticket-review deliverables name systems by their business names, not acronyms.
export const NAMING_RULES = [
  [/\bADO\b|\bAzure DevOps\b/g, 'DevOps'],
  [/\bCRM\b/g, 'Tickets System'],
];

export function namingFindings(text) {
  const out = [];
  text.split('\n').forEach((l, i) => {
    for (const [re, want] of NAMING_RULES) {
      re.lastIndex = 0;
      if (re.test(l)) out.push({ severity: 'major', rule: 'Naming rule', message: `Use “${want}”: “${l.trim().slice(0, 70)}”.`, where: `line ${i + 1}` });
    }
  });
  return out;
}

export const applyNaming = (text) => NAMING_RULES.reduce((t, [re, want]) => t.replace(re, want), text);

const JUDGEMENT = /^(my conclusion|pmo( view| conclusion| note)?:|as (a|the) pmo|in my view|my estimate)/i;
const QA = /\bqa\b/i;
const DEV = /\b(mobile|dev|developer|development|vendor) (team|side)?\b/i;

export function rcBlock({ rootCause = 'not set', solution = 'not set', deadline = 'not set' } = {}) {
  return `ROOT CAUSE: ${rootCause}\nSOLUTION: ${solution}\nDEADLINE: ${deadline}`;
}

/**
 * notes: raw text. meta: { title, date, purpose, requestedBy, hostedBy, attendees }
 * Returns { markdown, conflicts, judgements, candidates }.
 */
export function buildMinutes(notes, meta = {}) {
  const rawLines = String(notes).split(/\r?\n/).map((l) => l.trimEnd());
  const lines = rawLines.filter((l) => l.trim());
  const judgements = lines.filter((l) => JUDGEMENT.test(l.trim().replace(/^[-*•(]+\s*/, '')));
  const conflicts = lines.filter((l) => QA.test(l) && DEV.test(l) && /\b(but|however|disagree|says|claims|vs\.?|versus|while)\b/i.test(l));
  const candidates = extractRaidCandidates(lines.filter((l) => !judgements.includes(l)).join('\n'));
  const decisions = candidates.filter((c) => c.kind === 'Decision');
  const actions = candidates.filter((c) => c.kind === 'Action');
  const v = (x) => (x && String(x).trim() ? String(x).trim() : 'not set');
  const row = (cells) => `| ${cells.map((c) => String(c).replace(/\|/g, '/')).join(' | ')} |`;

  const markdown = `---
id: MINUTES
title: ${v(meta.title || 'Meeting minutes')}
type: minutes
gate: G3
owner: ${v(meta.hostedBy)}
status: Draft
---

# ${v(meta.title || 'Meeting minutes')}

| Meeting details | |
|---|---|
| Date / time | ${v(meta.date)} |
| Purpose | ${v(meta.purpose)} |
| Requested by | ${v(meta.requestedBy)} |
| Hosted by | ${v(meta.hostedBy)} |
| Attendees | ${v(meta.attendees)} |

## Decisions
| # | Item / discussion | Decision | Status | Owner | Due |
|---|---|---|---|---|---|
${decisions.length ? decisions.map((d, i) => row([`D${i + 1}`, d.author || '–', d.text, 'Agreed', d.owner, d.due])).join('\n') : row(['D1', 'none recorded', '', '', '', ''])}

## Action items
| # | Owner | Action | Due |
|---|---|---|---|
${actions.length ? actions.map((a, i) => row([`AI-${i + 1}`, a.owner, a.text, a.due])).join('\n') : row(['AI-1', 'not set', 'none recorded', ''])}

## Conflicts (QA position vs team position)
${conflicts.length ? conflicts.map((c) => `- **CONFLICT:** ${c.trim()}`).join('\n') : '- None recorded.'}

## Root cause / solution / deadline per item
\`\`\`
${rcBlock()}
\`\`\`

## Discussion – as written
${lines.filter((l) => !judgements.includes(l)).map((l) => `> ${l}`).join('\n') || '> (no notes)'}

## PMO judgement (not agreed by the team)
${judgements.length ? judgements.map((j) => `- ${j.trim()}`).join('\n') : '- None.'}
`;
  return { markdown, conflicts, judgements, candidates };
}

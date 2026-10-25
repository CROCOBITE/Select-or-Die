// Azure DevOps publish gate (DEC-06). Phase Zero never calls ADO itself: after the Project Owner types
// the exact approval phrase it writes a publish manifest to the outbox, which an operator (or Claude
// through the DevOps MCP) pushes. Without the phrase nothing is written anywhere.
import { parseStories } from './md.mjs';

export const APPROVAL_PHRASE = 'I agree CLAUDE add to AZUR BY ADO';

/** Exact words, case-sensitive; only surrounding whitespace is ignored. */
export const isApproved = (typed) => typeof typed === 'string' && typed.trim() === APPROVAL_PHRASE;

const PRIORITY = { must: 1, should: 2, could: 3, "won't": 4, wont: 4 };
const html = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const md2html = (s) => html(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\*([^*]+)\*/g, '<i>$1</i>');

/** Area and iteration paths carry no trailing separator, or matching returns zero rows. */
export function validateTarget(target) {
  const problems = [];
  if (!target?.project) problems.push('project is not set');
  if (!target?.areaPath) problems.push('areaPath is not set');
  for (const k of ['areaPath', 'iterationPath']) if (target?.[k] && /[\\/]$/.test(target[k])) problems.push(`${k} ends with a separator`);
  if (target?.areaPath && target?.project && !target.areaPath.startsWith(target.project)) problems.push('areaPath does not start with the project name');
  return problems;
}

/**
 * Builds Epic → Feature → Requirement items for a CMMI process project.
 * target: { project, areaPath, iterationPath?, requirementType? }
 */
export function buildManifest(storiesMarkdown, target) {
  const reqType = target.requirementType || 'Requirement';
  const items = [];
  for (const e of parseStories(storiesMarkdown)) {
    items.push({ ref: e.id, type: 'Epic', title: `${e.id} · ${e.title}`, parent: null });
    for (const f of e.features) {
      items.push({ ref: f.id, type: 'Feature', title: `${f.id} · ${f.title}`, parent: e.id });
      for (const s of f.stories) {
        const prio = PRIORITY[(s.priority.split(/\s/)[0] || '').toLowerCase()] ?? 2;
        items.push({
          ref: s.id,
          type: reqType,
          title: `${s.id} · ${s.title}`,
          parent: f.id,
          priority: prio,
          // No tags: creating a new tag is often permission-blocked (TF401289) and fails the whole write.
          // Category travels in the description instead.
          description: `<p>${md2html(s.story)}</p><p><b>Priority:</b> ${md2html(s.priority || 'not set')} · <b>Phase:</b> ${md2html(s.phase || 'not set')} · <b>Team:</b> ${md2html(s.team || 'not set')}</p><p><b>Source:</b> ${md2html(s.source)}</p>${
            s.dependencies ? `<p><b>Dependencies:</b> ${md2html(s.dependencies)}</p>` : ''
          }${s.privacy ? `<p><b>Privacy:</b> ${md2html(s.privacy)}</p>` : ''}${
            s.openQuestions ? `<p><b>Open questions:</b> ${md2html(s.openQuestions)}</p>` : ''
          }`,
          acceptanceCriteria: `<ol>${s.acceptance.map((a) => `<li>${md2html(a)}</li>`).join('')}</ol>`,
        });
      }
    }
  }
  return {
    target: { project: target.project, areaPath: target.areaPath, iterationPath: target.iterationPath || null },
    counts: items.reduce((c, i) => ({ ...c, [i.type]: (c[i.type] || 0) + 1 }), {}),
    items,
  };
}

export function manifestToMarkdown(m, approval) {
  return `# ADO publish manifest

| Field | Value |
|---|---|
| Target project | ${m.target.project} |
| Area path | ${m.target.areaPath} |
| Approved by | ${approval.by} |
| Approval phrase | "${APPROVAL_PHRASE}" |
| Approved at | ${approval.at} |
| Artifact version | ${approval.artifactKey} v${approval.version} (sha ${approval.sha}) |
| Items | ${Object.entries(m.counts).map(([k, v]) => `${v} ${k}`).join(', ')} |

| Ref | Type | Title | Parent | Priority |
|---|---|---|---|---|
${m.items.map((i) => `| ${i.ref} | ${i.type} | ${i.title.replace(/\|/g, '/')} | ${i.parent ?? '–'} | ${i.priority ?? ''} |`).join('\n')}
`;
}

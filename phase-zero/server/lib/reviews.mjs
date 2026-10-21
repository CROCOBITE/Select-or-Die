// Offline review engine. Each reviewer encodes the checklist of one skill from the AI skills pack
// (validating-project-scope, estimating-use-cases, evaluating-solution-value, structuring-requirements,
// PMO RAID/weekly discipline, charter rules, devops-rollout-plan, and the code-review skills).
// Findings: { severity: 'blocker'|'major'|'minor'|'info', rule, message, where }
import { parseTables, parseStories, allStories } from './md.mjs';
import { kpiRuleSweep, baselineRule, evidenceRule, processNotesRule, basisRule, diagnosticStandard } from './integrity.mjs';
import { reviewKpiReply } from './leadership.mjs';
import { reviewExecutive } from './executive.mjs';
import { namingFindings } from './minutes.mjs';

const finding = (severity, rule, message, where = '') => ({ severity, rule, message, where });
const WEIGHT = { blocker: 25, major: 10, minor: 3, info: 0 };
const score = (findings) => Math.max(0, 100 - findings.reduce((s, f) => s + WEIGHT[f.severity], 0));

const PATIENT_DATA = /\b(patient|medication|clinical|national id|resident id|diagnos|insurance|coverage|phone)\b/i;
const CLINICAL = /\b(clinical|medication|refill|pharmacy|diagnos|lab|radiology|pregnan)\b/i;
const MOSCOW = /^(must|should|could|won'?t)/i;

// ---------------------------------------------------------------- INVEST + DoR
function investDor(content) {
  const findings = [];
  const stories = allStories(parseStories(content));
  if (!stories.length) return { findings: [finding('blocker', 'DoR-0', 'No stories found in the Epic > Feature > Story format.')], stories: [] };
  const perStory = [];
  for (const s of stories) {
    const f = [];
    if (!/^As (an?|the) .+?, I want .+?, so that .+/i.test(s.story)) f.push(finding('major', 'DoR-1 Format', 'Story is not "As a…, I want…, so that…".', s.id));
    if (!s.acceptance.length) f.push(finding('blocker', 'DoR-2 AC', 'No acceptance criteria.', s.id));
    const gwt = s.acceptance.filter((a) => /given\b.*\bwhen\b.*\bthen\b/i.test(a)).length;
    if (s.acceptance.length && gwt < s.acceptance.length) f.push(finding('major', 'DoR-2 Given/When/Then', `${s.acceptance.length - gwt} criteria are not Given/When/Then.`, s.id));
    if (s.acceptance.length > 6) f.push(finding('minor', 'INVEST-S Small', `${s.acceptance.length} criteria; consider splitting (3–6 recommended).`, s.id));
    if (s.acceptance.length && s.acceptance.length < 3) f.push(finding('minor', 'INVEST-T Testable', 'Fewer than 3 criteria.', s.id));
    if (s.acceptance.length && !s.acceptance.some((a) => /failure|fails|unavailable|error|invalid|reject|block/i.test(a))) f.push(finding('major', 'AC exception case', 'No failure / exception criterion.', s.id));
    if (!s.source) f.push(finding('major', 'Traceability', 'No source section quoted.', s.id));
    if (!MOSCOW.test(s.priority)) f.push(finding('major', 'Priority', 'Priority is not MoSCoW from the source.', s.id));
    if (s.dependencies) f.push(finding('info', 'DoR-3 Dependencies', `Dependencies must be resolved before sprint: ${s.dependencies}`, s.id));
    if (/split/i.test(s.raw)) f.push(finding('minor', 'INVEST-S Small', 'Story itself flags it may need splitting.', s.id));
    if (s.openQuestions) f.push(finding('minor', 'INVEST-E Estimable', `Open question: ${s.openQuestions}`, s.id));
    if (PATIENT_DATA.test(s.raw) && !s.privacy && !/privacy|masked|verification/i.test(s.raw)) f.push(finding('major', 'DoR-5 NFR privacy', 'Touches patient data but carries no privacy note.', s.id));
    if (CLINICAL.test(s.story) && !s.clinicalOwner && !s.safety) f.push(finding('minor', 'Medical extras', 'Clinical story without named clinical owner / safety criterion.', s.id));
    if (s.estimate && !/team|_?\(team\)_?|blank/i.test(s.estimate)) f.push(finding('info', 'Estimate', 'Estimate present before team estimation.', s.id));
    perStory.push({ id: s.id, title: s.title, score: score(f), ready: !f.some((x) => x.severity === 'blocker' || x.severity === 'major') });
    findings.push(...f);
  }
  const ready = perStory.filter((p) => p.ready).length;
  findings.unshift(finding('info', 'Summary', `${ready} of ${perStory.length} stories meet the Definition of Ready.`));
  const avg = Math.round(perStory.reduce((t, p) => t + p.score, 0) / perStory.length);
  return { findings, stories: perStory, score: avg };
}

// ---------------------------------------------------------------- UCP estimation
// Weights from the standard UCP method (Karner). Factor ratings come from the story text and the
// project's architecture; the mapping to the org weight scale is an approximation, not the org tool.
const TCF_W = [2, 1, 1, 1, 1, 0.5, 0.5, 2, 1, 1, 1, 1, 1];
const ECF_W = [1.5, 0.5, 1, 0.5, 1, 2, -1, -1];
export const DEFAULT_FACTORS = {
  // T1..T13: distributed, performance, efficiency, complex processing, reuse, install, usability,
  // portable, changeable, concurrent, security, third-party access, training
  technical: [5, 4, 4, 3, 3, 1, 4, 1, 4, 4, 5, 4, 3],
  // E1..E8: model familiarity, domain, OO, lead analyst, motivation, stable reqs, part-time, language
  environmental: [3, 3, 3, 4, 3, 3, 3, 3],
};

export function ucp({ actors, transactions }, factors = DEFAULT_FACTORS) {
  const uaw = actors.reduce((s, a) => s + ({ simple: 1, average: 2, complex: 3 })[a], 0);
  const uucw = transactions <= 3 ? 5 : transactions <= 7 ? 10 : 15;
  const tcf = 0.6 + 0.01 * TCF_W.reduce((s, w, i) => s + w * factors.technical[i], 0);
  const ecf = 1.4 - 0.03 * ECF_W.reduce((s, w, i) => s + w * factors.environmental[i], 0);
  const points = (uaw + uucw) * tcf * ecf;
  const weight = points <= 3 ? 1 : points <= 6 ? 2 : points <= 10 ? 3 : points <= 16 ? 5 : points <= 25 ? 8 : 13;
  return { uaw, uucw, tcf: +tcf.toFixed(3), ecf: +ecf.toFixed(3), points: +points.toFixed(1), weight };
}

function estimate(content) {
  const findings = [];
  const rows = [];
  for (const s of allStories(parseStories(content))) {
    const systems = (s.team.match(/\+/g) || []).length + (/(dialer|avaya|api|feed|hmis|emr|pharmacy)/i.test(s.raw) ? 1 : 0);
    const actors = ['complex', ...Array.from({ length: Math.min(systems, 3) }, () => 'simple')];
    const transactions = s.acceptance.length + (s.dependencies ? 1 : 0);
    const r = ucp({ actors, transactions });
    rows.push({ id: s.id, title: s.title, ...r });
    if (r.weight >= 13) findings.push(finding('major', 'UCP ≥ 13', `Estimated weight ${r.weight} (UCP ${r.points}); break the story down.`, s.id));
  }
  const total = rows.reduce((s, r) => s + r.points, 0);
  findings.unshift(
    finding('info', 'Summary', `${rows.length} stories, total ≈ ${total.toFixed(0)} UCP. Ratings are indicative: teams own the estimate (weight mapping is an approximation of the org UCP tool).`)
  );
  return { findings, estimates: rows };
}

// ---------------------------------------------------------------- Solution value (charter objectives)
function solutionValue(content) {
  const findings = [];
  const objectives = parseTables(content).find((t) => t.headers.some((h) => /objective/i.test(h)) && t.headers.some((h) => /measure/i.test(h)));
  if (!objectives) return { findings: [finding('blocker', 'Value-1', 'No objectives table with a Measure column.')] };
  const mi = objectives.headers.findIndex((h) => /measure/i.test(h));
  const ti = objectives.headers.findIndex((h) => /target|direction/i.test(h));
  for (const r of objectives.rows) {
    const id = r[0];
    if (!r[mi]) findings.push(finding('major', 'Value-2 Measurable', 'Objective has no measure.', id));
    const target = ti >= 0 ? r[ti] : '';
    if (!target) findings.push(finding('major', 'Value-3 Target', 'No target or direction.', id));
    else if (/^baseline/i.test(target) || /track/i.test(target)) findings.push(finding('minor', 'Value-4 Baseline', `Target is "${target}". Record the baseline date and owner.`, id));
    if (/\b(calls?|volume|clicks?|logins?)\b/i.test(r[mi] || '') && !/conversion|booking|fulfil|value/i.test(r.join(' '))) findings.push(finding('major', 'Vanity metric', 'Activity metric without an outcome link.', id));
  }
  findings.unshift(finding('info', 'Summary', `${objectives.rows.length} objectives checked for measure, target and outcome linkage.`));
  return { findings };
}

// ---------------------------------------------------------------- Charter completeness
const CHARTER_SECTIONS = ['purpose', 'problem', 'different|objective', 'scope', 'how it works', 'timeline', 'who is involved', 'risk', 'decision'];
function charter(content) {
  const findings = [];
  const headings = [...content.matchAll(/^##\s+(.*)$/gm)].map((m) => m[1].toLowerCase());
  CHARTER_SECTIONS.forEach((s, i) => {
    if (!headings.some((h) => new RegExp(s).test(h))) findings.push(finding('major', `Charter §${i + 1}`, `Missing section matching "${s}".`));
  });
  if (/committed/i.test(content) && !/proposed/i.test(content)) findings.push(finding('major', 'Dates', 'Dates called committed with no "proposed" label.'));
  const tbc = (content.match(/\bTBC\b/g) || []).length;
  if (tbc) findings.push(finding('info', 'Owners', `${tbc} owners are TBC and visible (allowed, must be resolved before management).`));
  if (!/tailoring|not reported/i.test(content)) findings.push(finding('minor', 'Tailoring', 'No tailoring statement for PMBOK domains not reported.'));
  return { findings };
}

// ---------------------------------------------------------------- RAID discipline
function raid(content) {
  const findings = [];
  const tables = parseTables(content);
  const reg = (re) => tables.find((t) => re.test(t.heading));
  const col = (t, re) => t.headers.findIndex((h) => re.test(h));
  const actions = reg(/^actions/i);
  if (!actions) findings.push(finding('blocker', 'RAID-Actions', 'No Actions register.'));
  else {
    const o = col(actions, /owner/i);
    const d = col(actions, /due/i);
    const g = col(actions, /rag/i);
    const s = col(actions, /status/i);
    for (const r of actions.rows) {
      if (o < 0 || !r[o]) findings.push(finding('blocker', 'Action owner', 'Action without an owner.', r[0]));
      else if (/tbc/i.test(r[o])) findings.push(finding('minor', 'Action owner TBC', 'Owner TBC: resolve before the log goes to management.', r[0]));
      if (d < 0 || !r[d]) findings.push(finding('major', 'Action due date', 'Action without a due date.', r[0]));
      if (g < 0 || !/^(high|medium|low)$/i.test(r[g] || '')) findings.push(finding('major', 'RAG values', 'RAG must be High / Medium / Low.', r[0]));
      if (s < 0 || !r[s]) findings.push(finding('major', 'Action status', 'Action without status.', r[0]));
    }
    if (col(actions, /decision required/i) < 0) findings.push(finding('major', 'Decision required from', 'Actions register has no "Decision required from" column.'));
  }
  const issues = reg(/^issues/i);
  if (issues && col(issues, /age/i) < 0) findings.push(finding('minor', 'Issue age', 'Issues register has no age column; age is the pressure indicator.'));
  if (/\b(data is (messy|bad|poor)|data (problems|issues))\b/i.test(content) && !/\b(completeness|accuracy|consistency|timeliness|validity)\b/i.test(content))
    findings.push(finding('minor', 'Data-quality dimension', 'Name the broken property: completeness, accuracy, consistency, timeliness or validity.'));
  const esc = reg(/escalation/i);
  if (esc && col(esc, /response[- ]by|respond by|needed by|by$/i) < 0)
    findings.push(finding('minor', 'Escalation deadline', 'Escalations register has no response-by column; an escalation with no deadline has no force.'));
  const assumptions = reg(/^assumptions/i);
  if (assumptions) {
    const c = col(assumptions, /consequence/i);
    for (const r of assumptions.rows) if (c < 0 || !r[c]) findings.push(finding('major', 'Assumption consequence', 'Assumption with no consequence-if-wrong is decoration.', r[0]));
  }
  for (const t of tables.filter((t) => /^(risks|issues|assumptions|dependencies)/i.test(t.heading))) {
    const src = col(t, /source/i);
    if (src < 0) findings.push(finding('major', 'Provenance', `${t.heading}: no Source column.`));
    else for (const r of t.rows) if (!r[src]) findings.push(finding('major', 'Provenance', 'Entry without a source.', r[0]));
  }
  if (/\b(green|amber|yellow)\b/i.test(content)) findings.push(finding('minor', 'House colours', 'Use High / Medium / Low; no green, amber or yellow.'));
  findings.unshift(finding('info', 'Summary', `${tables.length} registers checked for owner, date, RAG, status, consequence and source.`));
  return { findings };
}

// ---------------------------------------------------------------- Weekly report structure
const WEEKLY = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A5a', 'A6', 'A7', 'A8', 'A9', 'A10', 'A10a', 'A11', 'B0', 'B1', 'B2', 'B3', 'B3a', 'B4', 'B4a', 'B5', 'B5a', 'B6'];
function weekly(content) {
  const findings = [];
  for (const s of WEEKLY) if (!new RegExp(`^#{2,4}\\s+${s}\\.`, 'm').test(content)) findings.push(finding('major', 'Locked structure', `Section ${s} missing. Sections never disappear; mark "Not supplied this week".`));
  for (const [re, label] of [[/next issue/i, 'next-issue date'], [/\bversion\b/i, 'version'], [/issue date/i, 'issue date'], [/prepared by/i, 'prepared by'], [/approver/i, 'approver']])
    if (!re.test(content)) findings.push(finding('minor', 'Document control', `No ${label} in the header.`));
  if (/\bweight\b/i.test((content.split(/### A9/)[1]?.split(/### A10/)[0] || '').split('\n').slice(1).join('\n'))) findings.push(finding('major', 'A9 no weight', 'Deliveries section must not show weight figures.'));
  return { findings };
}

// ---------------------------------------------------------------- Rollout plan
function rollout(content) {
  const findings = [];
  for (const [re, label] of [
    [/rollback/i, 'Rollback plan'],
    [/hypercare/i, 'Hypercare period'],
    [/go[-/ ]?(no[-/ ]?go|live)/i, 'Go / no-go criteria'],
    [/critical path/i, 'Critical path'],
    [/forecast/i, 'Forecast with assumption'],
    [/(UAT|acceptance)/i, 'User acceptance'],
  ])
    if (!re.test(content)) findings.push(finding('major', 'Rollout', `${label} not covered.`));
  return { findings };
}

// ---------------------------------------------------------------- Requirements structure (NFR coverage)
function nfr(content) {
  const findings = [];
  for (const [re, label] of [
    [/security|rbac|mfa|auth/i, 'Security'],
    [/performance|p95|load/i, 'Performance'],
    [/audit/i, 'Audit'],
    [/accessib/i, 'Accessibility'],
    [/arabic|rtl|locali/i, 'Localisation'],
    [/availability|resilien|outage/i, 'Resilience'],
    [/privacy|consent|mask/i, 'Privacy'],
  ])
    if (!re.test(content)) findings.push(finding('major', 'NFR checklist', `${label} not addressed.`));
  return { findings };
}

// ---------------------------------------------------------------- Code review (refactor / frontend / security skills)
const SECRET = /(api[_-]?key|secret|password|token)\s*[:=]\s*['"][A-Za-z0-9_\-]{12,}['"]/i;
const IGNORE = 'pz-ignore'; // marks lines that define these rules, so the scanner does not flag itself

const LINE_RULES = [
  [(l) => SECRET.test(l), 'blocker', 'security: hard-coded secret', 'Literal credential in source.'],
  [(l) => /\beval\(|new Function\(/.test(l), 'blocker', 'security: eval', 'Dynamic code execution.'], // pz-ignore
  [(l) => /dangerouslySetInnerHTML|\.innerHTML\s*=/.test(l), 'major', 'security: raw HTML', 'Raw HTML injection point; sanitise input.'], // pz-ignore
  [(l, p) => /console\.log\(/.test(l) && !p.startsWith('server/'), 'minor', 'frontend: console.log', 'Debug logging left in UI code.'], // pz-ignore
  [(l) => /<img(?![^>]*\balt=)/.test(l), 'major', 'frontend: a11y', 'Image without alt text.'], // pz-ignore
];

const FN_START = /^(export\s+)?(async\s+)?function\s+(\w+)|^\s*(const|let)\s+(\w+)\s*=\s*(async\s*)?\(.*\)\s*=>\s*\{/;

/** Length and brace depth of the function starting at line i. */
function measureFunction(lines, i) {
  let depth = 0;
  let maxDepth = 0;
  let started = false;
  for (let j = i; j < lines.length; j++) {
    for (const ch of lines[j]) {
      if (ch === '{') {
        depth++;
        started = true;
        maxDepth = Math.max(maxDepth, depth);
      } else if (ch === '}') depth--;
    }
    if (started && depth <= 0) return { length: j - i + 1, maxDepth };
  }
  return { length: lines.length - i, maxDepth };
}

function scanFunctions(path, lines) {
  const out = [];
  lines.forEach((line, i) => {
    const m = FN_START.exec(line);
    if (!m) return;
    const name = m[3] || m[5];
    const { length, maxDepth } = measureFunction(lines, i);
    if (length > 80) out.push(finding('minor', 'refactor-method-complexity-reduce', `${name}() is ${length} lines.`, `${path}:${i + 1}`));
    if (maxDepth > 6) out.push(finding('minor', 'refactor-method-complexity-reduce', `${name}() nests ${maxDepth} levels deep.`, `${path}:${i + 1}`));
  });
  return out;
}

export function reviewCode(files) {
  const findings = [];
  for (const { path, text } of files) {
    const lines = text.split('\n');
    if (lines.length > 600) findings.push(finding('minor', 'refactor: file size', `${lines.length} lines; consider splitting.`, path));
    lines.forEach((l, i) => {
      if (l.includes(IGNORE)) return;
      for (const [test, severity, rule, message] of LINE_RULES) if (test(l, path)) findings.push(finding(severity, rule, message, `${path}:${i + 1}`));
      if (/\b(TODO|FIXME)\b/.test(l)) findings.push(finding('info', 'refactor: TODO', l.trim().slice(0, 80), `${path}:${i + 1}`)); // pz-ignore
    });
    findings.push(...scanFunctions(path, lines));
  }
  findings.unshift(finding('info', 'Summary', `${files.length} files scanned (security, refactor, frontend a11y rules).`));
  return { findings, score: score(findings) };
}

// ---------------------------------------------------------------- report integrity (leadership-facing documents)
const LEADERSHIP_TYPES = /^(charter|weekly|kpi-reply|executive)$/;
function integrity(content) {
  const type = /^type:\s*(\S+)/m.exec(content)?.[1] || '';
  const findings = [...kpiRuleSweep(content), ...baselineRule(content), ...evidenceRule(content), ...basisRule(content)];
  // Correction notes and method notes are expected in PMO project docs (RAID, plan); only leadership documents ban them.
  if (LEADERSHIP_TYPES.test(type)) findings.push(...processNotesRule(content));
  findings.unshift(finding('info', 'Summary', 'Checked: KPI-feedback rule, baseline wording, not done vs not evidenced, metric bases, process notes. Run the 5-point rule and cross-table reconciliation on the figures themselves.'));
  return { findings };
}
const diagnostic = (content) => {
  const findings = diagnosticStandard(content);
  if (!findings.length && !/\|\s*finding/i.test(content)) findings.push(finding('minor', 'Diagnostic standard', 'No findings table. Each finding needs: finding, evidence, root cause, corrective action, preventive action.'));
  return { findings };
};
const kpiReply = (content) => reviewKpiReply(content);
const executive = (content) => reviewExecutive(content);
const naming = (content) => ({ findings: namingFindings(content) });

// ---------------------------------------------------------------- registry
export const REVIEWERS = [
  { id: 'validating-project-scope', name: 'INVEST + Definition of Ready', skill: 'validating-project-scope', types: ['stories'], run: investDor },
  { id: 'estimating-use-cases', name: 'Use Case Points estimate', skill: 'estimating-use-cases', types: ['stories'], run: estimate },
  { id: 'structuring-requirements', name: 'NFR coverage', skill: 'structuring-requirements', types: ['stories'], run: nfr },
  { id: 'evaluating-solution-value', name: 'Solution value (objectives)', skill: 'evaluating-solution-value', types: ['charter'], run: solutionValue },
  { id: 'charter-rules', name: 'Charter completeness', skill: 'user-stories-and-charter', types: ['charter'], run: charter },
  { id: 'pmo-raid', name: 'RAID discipline', skill: 'pmo-raid-log', types: ['raid'], run: raid },
  { id: 'pmo-weekly', name: 'Weekly report structure', skill: 'pmo-weekly-report', types: ['weekly'], run: weekly },
  { id: 'devops-rollout-plan', name: 'Rollout readiness', skill: 'devops-rollout-plan', types: ['plan'], run: rollout },
  { id: 'report-integrity', name: 'Report integrity (KPI-feedback rule)', skill: 'pmo-report-integrity', types: ['charter', 'plan', 'raid', 'weekly', 'release-notes', 'kpi-reply', 'executive', 'minutes'], run: integrity },
  { id: 'diagnostic-standard', name: 'Diagnostic standard (5 blocks)', skill: 'pmo-report-integrity', types: ['raid', 'weekly'], run: diagnostic },
  { id: 'kpi-reply-shape', name: 'KPI reply shape (Table A / B)', skill: 'leadership-kpi-reply', types: ['kpi-reply'], run: kpiReply },
  { id: 'executive-page', name: 'Executive page', skill: 'exec-team-deliverable', types: ['executive'], run: executive },
  { id: 'ticket-review-naming', name: 'Ticket-review naming', skill: 'ticket-review-minutes', types: ['minutes'], run: naming },
];

export function reviewersFor(type) {
  return REVIEWERS.filter((r) => r.types.includes(type));
}

export function runReview(reviewerId, content) {
  const r = REVIEWERS.find((x) => x.id === reviewerId);
  if (!r) throw new Error(`Unknown reviewer ${reviewerId}`);
  const out = r.run(content);
  return { reviewer: r.id, skill: r.skill, name: r.name, ...out, score: out.score ?? score(out.findings) };
}

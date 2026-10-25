// Dashboard view model. Computed from the artifacts, never typed in (RAID is the source).
import { parseTables, parseStories, allStories, plain } from './md.mjs';

const tableBy = (tables, re) => tables.find((t) => re.test(t.heading));
const col = (t, re) => (t ? t.headers.findIndex((h) => re.test(h)) : -1);
const rowsAsObjects = (t) =>
  t ? t.rows.map((r) => Object.fromEntries(t.headers.map((h, i) => [h, plain(r[i] ?? '')]))) : [];

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** Parses "18 Sep 2026", "18 September 2026", "2026-09-18"; returns null otherwise. */
export function parseDate(s) {
  if (!s) return null;
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
  const m = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/.exec(s);
  if (m && m[2].toLowerCase() in MONTHS) return new Date(Date.UTC(+m[3], MONTHS[m[2].toLowerCase()], +m[1]));
  return null;
}

/** "24 Sep – 09 Oct 2026" / "05 – 23 Oct 2026" → { start, end } */
export function parseRange(s) {
  const text = plain(s || '');
  const parts = text.split(/\s+[–-]\s+/);
  if (parts.length === 2) {
    const end = parseDate(parts[1]);
    if (!end) return { start: null, end: null };
    let start = parseDate(parts[0]);
    if (!start) {
      const dm = /(\d{1,2})(?:\s+([A-Za-z]{3}))?/.exec(parts[0]);
      if (dm) {
        const month = dm[2] ? MONTHS[dm[2].toLowerCase()] : end.getUTCMonth();
        start = new Date(Date.UTC(end.getUTCFullYear(), month, +dm[1]));
      }
    }
    return { start, end };
  }
  const d = parseDate(text);
  return { start: d, end: d };
}

const DAY = 86400000;

export function buildDashboard(artifacts, today = new Date()) {
  const byKey = Object.fromEntries(artifacts.map((a) => [a.key, a.content || '']));
  const raidTables = parseTables(byKey.RAID || '');
  const risks = rowsAsObjects(tableBy(raidTables, /^risks/i));
  const issues = rowsAsObjects(tableBy(raidTables, /^issues/i));
  const assumptions = rowsAsObjects(tableBy(raidTables, /^assumptions/i));
  const dependencies = rowsAsObjects(tableBy(raidTables, /^dependencies/i));
  const actionsT = tableBy(raidTables, /^actions/i);
  const actions = rowsAsObjects(actionsT);

  const ragKey = (o) => (o.RAG || o['RAG Status'] || '').split(/\s/)[0] || 'Unrated';
  const countBy = (list, fn) => list.reduce((c, x) => ((c[fn(x)] = (c[fn(x)] || 0) + 1), c), {});
  const isOpen = (o) => !/closed/i.test(o.Status || '');

  const dueSoon = actions
    .map((a) => ({ ...a, dueDate: parseDate(a['Due date'] || a['Due Date'] || '') }))
    .filter((a) => isOpen(a))
    .map((a) => ({ ...a, daysToDue: a.dueDate ? Math.round((a.dueDate - today) / DAY) : null }))
    .filter((a) => a.daysToDue === null || a.daysToDue <= 7)
    .sort((x, y) => (x.daysToDue ?? 99) - (y.daysToDue ?? 99));

  // Decisions: charter §9 table.
  const charterTables = parseTables(byKey.CHARTER || '');
  const decisions = rowsAsObjects(tableBy(charterTables, /decision/i));
  const objectives = rowsAsObjects(charterTables.find((t) => t.headers.some((h) => /objective/i.test(h)) && t.headers.some((h) => /measure/i.test(h))));

  // Schedule: first plan table that has start/finish or target columns.
  const planTables = parseTables(byKey.PLAN || '');
  const schedT = planTables.find((t) => col(t, /finish|target/i) >= 0 && /schedule|timeline/i.test(t.heading));
  const schedule = schedT
    ? schedT.rows.map((r) => {
        const o = Object.fromEntries(schedT.headers.map((h, i) => [h, plain(r[i] ?? '')]));
        const si = col(schedT, /start/i);
        const fi = col(schedT, /finish|target/i);
        const range = si >= 0 ? { start: parseDate(r[si]) || parseRange(r[fi]).start, end: parseRange(r[fi]).end } : parseRange(r[fi]);
        const status = o.Status || o['Status (18 Oct)'] || Object.entries(o).find(([k]) => /status/i.test(k))?.[1] || '';
        const late = range.end && range.end < today && !/^(done|complete)/i.test(status.trim());
        return {
          id: plain(r[0]),
          name: plain(r[1]),
          start: range.start?.toISOString().slice(0, 10) ?? null,
          end: range.end?.toISOString().slice(0, 10) ?? null,
          status,
          daysLate: late ? Math.round((today - range.end) / DAY) : 0,
        };
      })
    : [];

  const stories = allStories(parseStories(byKey.STORIES || ''));
  const prio = (s) => (s.priority.split(/\s/)[0] || 'not set');

  return {
    today: today.toISOString().slice(0, 10),
    decisions,
    dueSoon,
    raid: {
      risksByRag: countBy(risks.filter(isOpen), ragKey),
      issuesByRag: countBy(issues.filter(isOpen), ragKey),
      openRisks: risks.filter(isOpen).length,
      openIssues: issues.filter(isOpen).length,
      assumptionsUnconfirmed: assumptions.filter((a) => /unconfirmed|partly/i.test(a['Validation status'] || '')).length,
      dependenciesOpen: dependencies.filter(isOpen).length,
      ownersTbc: [...risks, ...issues, ...actions, ...dependencies].filter((o) => /tbc/i.test(o.Owner || '')).length,
      topRisks: risks.filter((r) => isOpen(r) && /^high/i.test(ragKey(r))).slice(0, 5),
      topIssues: issues
        .filter((r) => isOpen(r))
        .map((r) => {
          const raised = parseDate(r.Raised || '');
          return raised ? { ...r, 'Age (days)': String(Math.max(0, Math.round((today - raised) / DAY))) } : r;
        })
        .slice(0, 5),
    },
    schedule,
    objectives,
    backlog: {
      total: stories.length,
      byPriority: countBy(stories, prio),
      byEpic: countBy(stories, (s) => s.epic),
      withOpenQuestions: stories.filter((s) => s.openQuestions).length,
    },
  };
}

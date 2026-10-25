// Markdown helpers: front matter, tables and the Epic > Feature > Story format.

export function parseFrontMatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: text.slice(m[0].length) };
}

export function stringifyFrontMatter(meta, body) {
  const lines = Object.entries(meta).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join('\n')}\n---\n\n${body.replace(/^\n+/, '')}`;
}

const splitRow = (line) =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

const isSeparator = (line) => /^\s*\|?\s*:?-{2,}/.test(line) && /^[\s|:-]+$/.test(line);

/** Returns [{ heading, headers, rows }] for every pipe table in the document. */
export function parseTables(text) {
  const lines = text.split('\n');
  const tables = [];
  let heading = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = /^#{1,6}\s+(.*)/.exec(line);
    if (h) heading = h[1].trim();
    if (line.trim().startsWith('|') && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const headers = splitRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      i--;
      tables.push({ heading, headers, rows });
    }
  }
  return tables;
}

const field = (block, name) => {
  const re = new RegExp(`^- \\*\\*${name}:\\*\\*\\s*(.*)$`, 'mi');
  const m = re.exec(block);
  return m ? m[1].trim() : '';
};

/**
 * Parses the Epic (##) > Feature (###) > Story (####) format used in 03-user-stories.md.
 * Stories without a feature heading attach to a synthetic feature named after the epic.
 */
export function parseStories(text) {
  const { body } = parseFrontMatter(text);
  const epics = [];
  let epic = null;
  let feature = null;
  const lines = body.split('\n');
  let story = null;
  let buf = [];

  const flush = () => {
    if (!story) return;
    const block = buf.join('\n');
    const acStart = block.search(/- \*\*Acceptance criteria:\*\*/i);
    const ac = [];
    if (acStart >= 0) {
      for (const l of block.slice(acStart).split('\n').slice(1)) {
        const m = /^\s+\d+\.\s+(.*)/.exec(l);
        if (m) ac.push(m[1].trim());
        else if (/^- \*\*/.test(l)) break;
      }
    }
    const prio = field(block, 'Priority');
    const [priority, phase, team] = prio.split('·').map((s) => s.replace(/\*\*[^*]+:\*\*/g, '').trim());
    Object.assign(story, {
      story: field(block, 'Story'),
      priority: priority || '',
      phase: phase || '',
      team: team || '',
      source: field(block, 'Source'),
      acceptance: ac,
      dependencies: field(block, 'Dependencies(?: / assumptions)?'),
      privacy: field(block, 'Privacy'),
      clinicalOwner: field(block, 'Clinical owner') || field(block, 'Data owner'),
      safety: field(block, 'Safety'),
      estimate: field(block, 'Estimate'),
      openQuestions: field(block, 'Open questions'),
      raw: block,
    });
    feature.stories.push(story);
    story = null;
    buf = [];
  };

  for (const line of lines) {
    let m;
    if ((m = /^## (EP-[\w.]+)\s*·\s*(.*)/.exec(line))) {
      flush();
      epic = { id: m[1], title: m[2].trim(), features: [] };
      epics.push(epic);
      feature = null;
    } else if ((m = /^### (FE-[\w.]+)\s*·\s*(.*)/.exec(line))) {
      flush();
      feature = { id: m[1], title: m[2].trim(), stories: [] };
      epic.features.push(feature);
    } else if ((m = /^#### (US-\d+)\s*·\s*(.*)/.exec(line))) {
      flush();
      if (!epic) continue;
      if (!feature) {
        feature = { id: `${epic.id.replace('EP', 'FE')}.0`, title: epic.title, stories: [] };
        epic.features.push(feature);
      }
      story = { id: m[1], title: m[2].trim() };
    } else if (/^## /.test(line)) {
      flush();
      epic = null;
      feature = null;
    } else if (story) {
      buf.push(line);
    }
  }
  flush();
  return epics;
}

export const allStories = (epics) =>
  epics.flatMap((e) => e.features.flatMap((f) => f.stories.map((s) => ({ ...s, epic: e.id, feature: f.id }))));

export const escapeXml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Strips inline markdown (bold, italics, code, links) for plain-text outputs. */
export const plain = (s) =>
  String(s)
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1');

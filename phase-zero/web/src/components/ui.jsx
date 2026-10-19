import React, { useState } from 'react';

export function RagPill({ value }) {
  const v = String(value || '').replace(/\*/g, '').trim();
  const cls = /^(high|critical|overdue|blocked|stranded)/i.test(v) ? 'high' : /^(medium|at risk|held|watch)/i.test(v) ? 'medium' : '';
  return <span className={`pz-pill ${cls}`}>{v || '–'}</span>;
}

export function Modal({ title, children, onClose }) {
  return (
    <div className="pz-modal-back" role="presentation" onClick={onClose}>
      <div className="pz-modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <div className="pz-field">
      <label>{label}</label>
      {children}
    </div>
  );
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return <div className="pz-alert error" role="alert">{error}</div>;
}

export function useTooltip() {
  const [tip, setTip] = useState(null);
  const bind = (text) => ({
    onMouseMove: (e) => setTip({ text, x: e.clientX + 12, y: e.clientY + 12 }),
    onMouseLeave: () => setTip(null),
    onFocus: (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      setTip({ text, x: r.right + 8, y: r.top });
    },
    onBlur: () => setTip(null),
    tabIndex: 0,
    'aria-label': text,
  });
  const node = tip ? <div className="pz-tooltip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div> : null;
  return [bind, node];
}

// ------------------------------------------------------------------ Markdown → React (no raw HTML)
function inline(text, key = 0) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_\([^)]*\)_|~~[^~]+~~|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((p, i) => {
    const k = `${key}-${i}`;
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={k}>{p.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(p)) return <code key={k}>{p.slice(1, -1)}</code>;
    if (/^~~[^~]+~~$/.test(p)) return <s key={k}>{p.slice(2, -2)}</s>;
    if (/^_\(.*\)_$/.test(p)) return <em key={k}>{p.slice(1, -1)}</em>;
    if (/^\*[^*]+\*$/.test(p)) return <em key={k}>{p.slice(1, -1)}</em>;
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(p);
    if (link) return /^https?:\/\//.test(link[2]) ? <a key={k} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a> : <span key={k}>{link[1]}</span>;
    return p;
  });
}

const splitRow = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export function Markdown({ text }) {
  const body = String(text || '').replace(/^---\n[\s\S]*?\n---\n?/, '');
  const lines = body.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (line.trim().startsWith('```')) {
      const code = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i++]);
      out.push(<pre key={i}><code>{code.join('\n')}</code></pre>);
      i++;
    } else if ((m = /^(#{1,4})\s+(.*)/.exec(line))) {
      const H = `h${m[1].length}`;
      out.push(<H key={i}>{inline(m[2], i)}</H>);
      i++;
    } else if (line.trim().startsWith('|') && /^[\s|:-]+$/.test(lines[i + 1] || 'x')) {
      const headers = splitRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(splitRow(lines[i++]));
      const ragCol = headers.findIndex((h) => /^(rag|rag status)$/i.test(h));
      out.push(
        <div className="pz-table-wrap" key={i}>
          <table className="pz-table">
            <thead><tr>{headers.map((h, c) => <th key={c}>{inline(h)}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>{headers.map((_, c) => <td key={c}>{c === ragCol ? <RagPill value={r[c]} /> : inline(r[c] ?? '', `${ri}-${c}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    } else if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items = [];
      const ordered = /^\s*\d+\./.test(line);
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        const depth = Math.floor(/^(\s*)/.exec(lines[i])[1].length / 2);
        items.push(<li key={i} style={{ marginLeft: depth * 16 }}>{inline(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''), i)}</li>);
        i++;
      }
      out.push(ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>);
    } else if ((m = /^>\s?(.*)/.exec(line))) {
      const quote = [];
      while (i < lines.length && /^>/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ''));
      out.push(<blockquote key={i}>{quote.map((q, qi) => <div key={qi}>{inline(q, qi)}</div>)}</blockquote>);
      m = null;
    } else if (/^---+$/.test(line.trim())) {
      out.push(<hr key={i} />);
      i++;
    } else if (line.trim()) {
      out.push(<p key={i}>{inline(line, i)}</p>);
      i++;
    } else i++;
  }
  return <div className="pz-md">{out}</div>;
}

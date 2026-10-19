// Markdown → .docx (WordprocessingML) with the house style: Dubai font, navy headers,
// pale-blue zebra rows, orange RAG cells, US Letter page. No external dependencies.
import { zip } from './zip.mjs';
import { escapeXml, parseFrontMatter } from './md.mjs';

const NAVY = '1F3864';
const ZEBRA = 'DCE6F1';
const HIGH = 'C0511B';
const MEDIUM = 'FBC08A';

function runs(text, { bold = false, color } = {}) {
  // Split on **bold** and `code`; drop other markdown emphasis.
  const parts = String(text)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .filter(Boolean);
  return parts
    .map((p) => {
      let t = p;
      let b = bold;
      let mono = false;
      if (/^\*\*[^*]+\*\*$/.test(p)) {
        t = p.slice(2, -2);
        b = true;
      } else if (/^`[^`]+`$/.test(p)) {
        t = p.slice(1, -1);
        mono = true;
      }
      t = t.replace(/\*([^*]+)\*/g, '$1').replace(/~~([^~]+)~~/g, '$1');
      const rpr = [
        b ? '<w:b/>' : '',
        color ? `<w:color w:val="${color}"/>` : '',
        mono ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : '',
      ].join('');
      return `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${escapeXml(t)}</w:t></w:r>`;
    })
    .join('');
}

const para = (inner, { style, spacing = true, shade } = {}) =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${
    spacing ? '<w:spacing w:before="50" w:after="50"/>' : ''
  }${shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : ''}</w:pPr>${inner}</w:p>`;

function ragFill(text) {
  const t = text.replace(/\*/g, '').trim().toLowerCase();
  if (/^(high|critical|overdue|blocked|stranded)\b/.test(t)) return { fill: HIGH, color: 'FFFFFF' };
  if (/^(medium|at risk|held|watch)\b/.test(t)) return { fill: MEDIUM };
  return null;
}

function table(headers, rows) {
  const cols = headers.length;
  const width = Math.floor(9360 / cols);
  const cell = (text, { header = false, zebra = false } = {}) => {
    const rag = header ? null : ragFill(text);
    const fill = header ? NAVY : rag ? rag.fill : zebra ? ZEBRA : null;
    const color = header ? 'FFFFFF' : rag?.color;
    return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${
      fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ''
    }<w:tcMar><w:top w:w="50" w:type="dxa"/><w:bottom w:w="50" w:type="dxa"/><w:left w:w="85" w:type="dxa"/><w:right w:w="85" w:type="dxa"/></w:tcMar></w:tcPr>${para(
      runs(text || ' ', { bold: header, color }),
      { spacing: false }
    )}</w:tc>`;
  };
  const head = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${headers.map((h) => cell(h || ' ', { header: true })).join('')}</w:tr>`;
  const body = rows
    .map((r, i) => {
      const cells = Array.from({ length: cols }, (_, c) => r[c] ?? '');
      return `<w:tr>${cells.map((c) => cell(c, { zebra: i % 2 === 1 })).join('')}</w:tr>`;
    })
    .join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`)
    .join('')}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${headers
    .map(() => `<w:gridCol w:w="${width}"/>`)
    .join('')}</w:tblGrid>${head}${body}</w:tbl>${para('', { spacing: false })}`;
}

const splitRow = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export function markdownToDocumentXml(markdown) {
  const { body } = parseFrontMatter(markdown);
  const lines = body.split('\n');
  const out = [];
  let inCode = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(para(runs('`' + (line || ' ') + '`'), { spacing: false, shade: 'F2F2F2' }));
      continue;
    }
    let m;
    if ((m = /^(#{1,4})\s+(.*)/.exec(line))) {
      out.push(para(runs(m[2]), { style: `Heading${m[1].length}` }));
    } else if (line.trim().startsWith('|') && /^[\s|:-]+$/.test(lines[i + 1] || 'x')) {
      const headers = splitRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(splitRow(lines[i++]));
      i--;
      out.push(table(headers, rows));
    } else if ((m = /^(\s*)[-*]\s+(.*)/.exec(line))) {
      const indent = Math.min(3, Math.floor(m[1].length / 2));
      out.push(
        `<w:p><w:pPr><w:spacing w:before="20" w:after="20"/><w:ind w:left="${360 + indent * 360}" w:hanging="240"/></w:pPr>${runs('• ' + m[2])}</w:p>`
      );
    } else if ((m = /^(\s*)(\d+)\.\s+(.*)/.exec(line))) {
      const indent = Math.min(3, Math.floor(m[1].length / 2));
      out.push(
        `<w:p><w:pPr><w:spacing w:before="20" w:after="20"/><w:ind w:left="${360 + indent * 360}" w:hanging="300"/></w:pPr>${runs(`${m[2]}. ${m[3]}`)}</w:p>`
      );
    } else if ((m = /^>\s?(.*)/.exec(line))) {
      out.push(para(runs(m[1]), { shade: ZEBRA }));
    } else if (/^---+$/.test(line.trim())) {
      out.push(`<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="${NAVY}"/></w:pBdr></w:pPr></w:p>`);
    } else if (line.trim()) {
      out.push(para(runs(line)));
    }
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${out.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Dubai" w:hAnsi="Dubai" w:cs="Dubai" w:eastAsia="Dubai"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
${[1, 2, 3, 4]
  .map(
    (n) =>
      `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="${240 - n * 30}" w:after="80"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:color w:val="${NAVY}"/><w:sz w:val="${36 - n * 4}"/></w:rPr></w:style>`
  )
  .join('')}
</w:styles>`;

export function markdownToDocx(markdown) {
  return zip([
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    },
    {
      name: 'word/_rels/document.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: 'word/styles.xml', data: STYLES },
    { name: 'word/document.xml', data: markdownToDocumentXml(markdown) },
  ]);
}

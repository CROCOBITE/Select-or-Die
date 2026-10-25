"""Markdown -> Word (.docx) in the PMO document palette. Standard library only.

House style (from the PMO's issued reports): Dubai font, navy 1F3864 headings and table headers
with white text, DCE6F1 zebra rows, BFBFBF borders, 595959 notes. RAG uses the house oranges –
C0511B High/Red with white text, FBC08A Medium/Amber, Low left plain (no green). A4 portrait,
classification and title in the header, "Page X of Y" in the footer. Arabic paragraphs are set
right-to-left.
"""

import io
import re
import zipfile
from xml.sax.saxutils import escape

from .arabic import direction

NAVY, ZEBRA, BORDER, GREY = "1F3864", "DCE6F1", "BFBFBF", "595959"
RAG = {"high": ("C0511B", "FFFFFF"), "red": ("C0511B", "FFFFFF"), "critical": ("C0511B", "FFFFFF"),
       "blocked": ("C0511B", "FFFFFF"), "medium": ("FBC08A", "000000"), "amber": ("FBC08A", "000000"),
       "at risk": ("FBC08A", "000000"), "needs confirming": ("FBC08A", "000000")}
FONT = "Dubai"
W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' \
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'


def _run(text, bold=False, italic=False, mono=False, color=None, size=None, rtl=False):
    props = [f'<w:rFonts w:ascii="{"Consolas" if mono else FONT}" w:hAnsi="{"Consolas" if mono else FONT}" w:cs="{FONT}"/>']
    if bold:
        props.append("<w:b/><w:bCs/>")
    if italic:
        props.append("<w:i/>")
    if color:
        props.append(f'<w:color w:val="{color}"/>')
    if size:
        props.append(f'<w:sz w:val="{size}"/><w:szCs w:val="{size}"/>')
    if rtl:
        props.append("<w:rtl/>")
    return f'<w:r><w:rPr>{"".join(props)}</w:rPr><w:t xml:space="preserve">{escape(text)}</w:t></w:r>'


def _inline(text, color=None, size=None, bold=False):
    rtl = direction(text) == "rtl"
    out = []
    for part in re.split(r"(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_)", text):
        if not part:
            continue
        if part.startswith("**"):
            out.append(_run(part[2:-2], bold=True, color=color, size=size, rtl=rtl))
        elif part.startswith("`"):
            out.append(_run(part[1:-1], mono=True, color=GREY, size=size, rtl=False))
        elif part.startswith("_") and part.endswith("_") and len(part) > 2:
            out.append(_run(part[1:-1], italic=True, color=color or GREY, size=size, rtl=rtl))
        else:
            out.append(_run(part, bold=bold, color=color, size=size, rtl=rtl))
    return "".join(out)


def _para(text, style=None, color=None, size=None, bullet=False, bold=False):
    ppr = []
    if style:
        ppr.append(f'<w:pStyle w:val="{style}"/>')
    if bullet:
        ppr.append('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>')
    if direction(text) == "rtl":
        ppr.append('<w:bidi/><w:jc w:val="right"/>')
    return f'<w:p><w:pPr>{"".join(ppr)}</w:pPr>{_inline(text, color, size, bold)}</w:p>'


def _cell(text, header=False, zebra=False):
    fill, color = (NAVY, "FFFFFF") if header else RAG.get(text.strip().lower(), (ZEBRA if zebra else None, None))
    shade = f'<w:shd w:val="clear" w:color="auto" w:fill="{fill}"/>' if fill else ""
    return (f'<w:tc><w:tcPr>{shade}</w:tcPr>'
            f'{_para(text, color=color, size=18, bold=header)}</w:tc>')


def _table(lines):
    rows = [[c.strip() for c in l.strip().strip("|").split("|")] for l in lines if not re.match(r"^\|\s*-", l.strip())]
    borders = "".join(f'<w:{s} w:val="single" w:sz="4" w:color="{BORDER}"/>'
                      for s in ("top", "left", "bottom", "right", "insideH", "insideV"))
    body = []
    for i, row in enumerate(rows):
        header = i == 0
        cells = "".join(_cell(c, header=header, zebra=(i % 2 == 0 and not header)) for c in row)
        trpr = "<w:trPr><w:tblHeader/></w:trPr>" if header else ""
        body.append(f"<w:tr>{trpr}{cells}</w:tr>")
    return (f'<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>{borders}</w:tblBorders>'
            f'<w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>'
            f'{"".join(body)}</w:tbl><w:p/>')


def body_xml(md):
    out, buf = [], []
    for line in md.splitlines() + [""]:
        if line.strip().startswith("|"):
            buf.append(line)
            continue
        if buf:
            out.append(_table(buf))
            buf = []
        out.append(_line(line))
    return "".join(x for x in out if x)


def _line(line):
    s = line.rstrip()
    if not s.strip() or s.strip() == "---":
        return ""
    if s.startswith("# "):
        return _para(s[2:], style="Title")
    if s.startswith("## "):
        return _para(s[3:], style="Heading1")
    if s.startswith("### "):
        return _para(s[4:], style="Heading2")
    if re.match(r"^\s*[-*] ", s):
        return _para(re.sub(r"^\s*[-*] ", "", s), bullet=True)
    return _para(s)


STYLES = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles {W}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="{FONT}" w:hAnsi="{FONT}" w:cs="{FONT}"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:b/><w:color w:val="{NAVY}"/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="{NAVY}"/></w:pBdr></w:pPr><w:rPr><w:b/><w:color w:val="{NAVY}"/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:keepNext/></w:pPr><w:rPr><w:b/><w:color w:val="{NAVY}"/><w:sz w:val="22"/></w:rPr></w:style>
</w:styles>"""

NUMBERING = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering {W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="360" w:hanging="240"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>"""


def _header(text):
    return (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr {W}>'
            f'{_para(text, color=GREY, size=16)}</w:hdr>')


def _footer(text):
    field = lambda code: (f'<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> {code} </w:instrText></w:r>'
                          f'<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>')
    return (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr {W}><w:p><w:pPr><w:jc w:val="center"/></w:pPr>'
            f'{_run(text + "  ·  Page ", color=GREY, size=16)}{field("PAGE")}{_run(" of ", color=GREY, size=16)}{field("NUMPAGES")}</w:p></w:ftr>')


def build(md, title="Minutes", classification="Internal", footer_text=""):
    document = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {W}><w:body>{body_xml(md)}'
                '<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/><w:footerReference w:type="default" r:id="rIdF"/>'
                '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="900" w:bottom="1080" w:left="900" w:header="500" w:footer="500"/>'
                '</w:sectPr></w:body></w:document>')
    files = {
        "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
            '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
            '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
            '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
            '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
        "_rels/.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
        "word/_rels/document.xml.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
            '<Relationship Id="rIdN" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>'
            '<Relationship Id="rIdH" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>'
            '<Relationship Id="rIdF" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>',
        "docProps/core.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
            f'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>{escape(title)}</dc:title></cp:coreProperties>',
        "word/document.xml": document, "word/styles.xml": STYLES, "word/numbering.xml": NUMBERING,
        "word/header1.xml": _header(f"{classification}  ·  {title}"),
        "word/footer1.xml": _footer(footer_text or title),
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, content in files.items():
            z.writestr(name, content)
    return buf.getvalue()

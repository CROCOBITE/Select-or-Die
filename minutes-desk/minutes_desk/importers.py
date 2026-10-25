"""Import transcripts that already exist, so no speech recognition is needed:

- Microsoft Teams / Zoom transcripts (.vtt, .srt, Teams .docx)
- WhatsApp chat exports (.txt, iOS and Android formats; several overlapping exports merge)
- plain notes (.txt / .md), optionally "Name: text" per line
"""

import re
import zipfile
from datetime import datetime
from xml.etree import ElementTree

TS = r"(\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?"
CUE = re.compile(rf"^\s*({TS})\s*-->\s*({TS})")
VTT_VOICE = re.compile(r"^<v\s+([^>]+)>(.*?)(?:</v>)?$")
SPEAKER = re.compile(r"^\s*([^:\n]{2,40}?):\s+(.+)$")
WA_IOS = re.compile(r"^‎?\[(\d{1,2}/\d{1,2}/\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?\s*[AP]M)\]\s*([^:]+?):\s?(.*)$")
WA_ANDROID = re.compile(r"^‎?(\d{1,2}/\d{1,2}/\d{2,4}),\s*(\d{1,2}:\d{2}(?:\s*[AP]M)?)\s*-\s*([^:]+?):\s?(.*)$")
WA_SYSTEM = ("end-to-end encrypted", "created group", "added", "left", "joined using", "changed the subject",
             "<Media omitted>", "image omitted", "sticker omitted", "This message was deleted")


def seconds(stamp):
    stamp = stamp.replace(",", ".")
    parts = [float(p) for p in stamp.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0.0)
    return parts[0] * 3600 + parts[1] * 60 + parts[2]


def detect(name, text):
    lower = name.lower()
    if lower.endswith(".vtt") or text.lstrip().startswith("WEBVTT"):
        return "vtt"
    if lower.endswith(".srt") or CUE.search(text[:500] or ""):
        return "srt"
    head = text[:3000].splitlines()
    if sum(bool(WA_IOS.match(l) or WA_ANDROID.match(l)) for l in head) >= 3:
        return "whatsapp"
    return "notes"


def parse(name, data):
    """data is bytes. Returns {"kind": ..., "segments": [...]}."""
    if name.lower().endswith(".docx"):
        return {"kind": "teams-docx", "segments": parse_teams_docx(data)}
    text = data.decode("utf-8-sig", "replace")
    kind = detect(name, text)
    parser = {"vtt": parse_cues, "srt": parse_cues, "whatsapp": parse_whatsapp, "notes": parse_notes}[kind]
    return {"kind": kind, "segments": parser(text)}


def parse_cues(text):
    segs, cur = [], None
    for line in text.splitlines():
        m = CUE.match(line)
        if m:
            cur = {"start": seconds(m.group(1)), "end": seconds(m.group(3)), "text": "", "speaker": ""}
            segs.append(cur)
        elif cur is not None and line.strip() and not line.strip().isdigit():
            voice = VTT_VOICE.match(line.strip())
            if voice:
                cur["speaker"], line = voice.group(1).strip(), voice.group(2)
            cur["text"] = (cur["text"] + " " + re.sub(r"<[^>]+>", "", line).strip()).strip()
    return [s for s in segs if s["text"]]


def parse_notes(text):
    segs = []
    for i, line in enumerate(l for l in text.splitlines() if l.strip()):
        m = SPEAKER.match(line)
        speaker, body = (m.group(1).strip(), m.group(2)) if m and not m.group(1).strip().startswith(("http", "-")) else ("", line.strip())
        segs.append({"start": None, "end": None, "line": i + 1, "speaker": speaker, "text": body.strip()})
    return segs


def parse_teams_docx(data):
    """Teams 'Download transcript' .docx: a 'Name   0:01' paragraph followed by what was said."""
    with zipfile.ZipFile(_bytes_io(data)) as z:
        root = ElementTree.fromstring(z.read("word/document.xml"))
    ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    paras = ["".join(t.text or "" for t in p.iter(ns + "t")).strip() for p in root.iter(ns + "p")]
    head = re.compile(rf"^(.+?)\s+({TS})$")
    segs, cur = [], None
    for p in filter(None, paras):
        m = head.match(p)
        if m and len(m.group(1)) <= 60:
            cur = {"start": seconds(m.group(2)), "end": None, "speaker": m.group(1).strip(), "text": ""}
            segs.append(cur)
        elif cur is not None:
            cur["text"] = (cur["text"] + " " + p).strip()
        else:
            segs.append({"start": None, "end": None, "speaker": "", "text": p})
    return [s for s in segs if s["text"]]


def _bytes_io(data):
    import io
    return io.BytesIO(data)


def parse_whatsapp(text, since=None, until=None):
    msgs, cur = [], None
    for line in text.splitlines():
        m = WA_IOS.match(line) or WA_ANDROID.match(line)
        if m:
            cur = {"at": _wa_time(m.group(1), m.group(2)), "speaker": _wa_speaker(m.group(3)), "text": m.group(4).strip()}
            msgs.append(cur)
        elif cur is not None and line.strip():
            cur["text"] += "\n" + line.strip()
    keep = [m for m in msgs if m["text"] and not any(s in m["text"] for s in WA_SYSTEM) and m["text"] != "- [Call]"]
    keep = [m for m in keep if (not since or m["at"] >= since) and (not until or m["at"] <= until)]
    return [dict(m, start=None, end=None) for m in keep]


def _wa_speaker(name):
    """Unsaved contacts appear as phone numbers; keep only the last three digits."""
    name = name.strip().lstrip("~").strip()
    digits = re.sub(r"\D", "", name)
    if len(digits) >= 8 and not re.search(r"[A-Za-z\u0600-\u06FF]", name):
        return f"Unsaved contact …{digits[-3:]}"
    return name


def _wa_time(day, clock):
    clock = clock.replace(" ", " ").strip()
    for fmt in ("%m/%d/%y %I:%M:%S %p", "%m/%d/%y %I:%M %p", "%d/%m/%Y %H:%M", "%d/%m/%y %H:%M",
                "%m/%d/%Y %I:%M:%S %p", "%d/%m/%Y %I:%M %p"):
        try:
            return datetime.strptime(f"{day} {clock}", fmt).isoformat(timespec="minutes")
        except ValueError:
            continue
    return f"{day} {clock}"


def merge_chats(exports):
    """Several overlapping exports of the same chat -> one de-duplicated, ordered list."""
    seen, out = set(), []
    for segs in exports:
        for m in segs:
            key = (m.get("at"), m.get("speaker"), m.get("text", "")[:80])
            if key not in seen:
                seen.add(key)
                out.append(m)
    return sorted(out, key=lambda m: m.get("at") or "")

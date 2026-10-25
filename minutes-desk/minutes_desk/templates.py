"""Minutes templates. Output is Markdown (the editable, versioned source); exports render it.

Every template shares one spine, so management always finds the same things in the same place:
document control -> read this first -> management summary -> decisions -> actions -> issues & root
cause -> dependencies/conflicts -> to confirm before sending (one consolidated request pack).
Templates differ only in the middle sections.
"""

import re

from .extract import speakers
from .governance import apply_naming

TEMPLATES = {
    "recording": "Meeting from a recording (default)",
    "ticket": "Ticket / working meeting",
    "committee": "Committee meeting",
    "steering": "Steering / leadership",
    "follow-up": "Quick follow-up",
    "lecture": "Lecture or training session",
    "chat-digest": "Management chat digest (WhatsApp / Teams chat)",
}

TICKET = re.compile(r"#\s?(\d{4,6})\b")
NOT_STATED = "Not stated"


def cell(value):
    return str(value or "").replace("|", "/").replace("\n", " ").strip() or NOT_STATED


def table(headers, rows):
    if not rows:
        return "_None recorded._\n"
    lines = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    lines += ["| " + " | ".join(cell(c) for c in row) + " |" for row in rows]
    return "\n".join(lines) + "\n"


def due_text(due):
    if not due:
        return "Date not stated"
    return f"{due['date']} (said: “{due['said']}”)" if due.get("resolved") else due["date"]


# --------------------------------------------------------------------------- shared sections

def document_control(meta, transcript, template):
    rows = [
        ("Meeting", meta.get("title")), ("Audience", meta.get("audience") or TEMPLATES[template]),
        ("Date and time", meta.get("date")), ("Duration", _duration(transcript)),
        ("Chair", meta.get("chair") or "Not confirmed"), ("Minute-taker", meta.get("author")),
        ("Source", _source(transcript)), ("Distribution", ", ".join(meta.get("distribution") or []) or "Not set"),
        ("Validator", meta.get("validator") or "Not set"), ("Version", meta.get("version", "Draft")),
        ("Classification", meta.get("classification") or "Internal"),
    ]
    return "## Document control\n\n" + table(["Field", "Detail"], rows)


def _duration(transcript):
    dur = transcript.get("duration")
    return f"{round(dur / 60)} minutes" if dur else NOT_STATED


def _source(transcript):
    kind = transcript.get("kind") or transcript.get("engine") or "notes"
    model = transcript.get("model")
    return f"{kind} ({model})" if model else kind


def read_this_first(transcript):
    segs = transcript.get("segments", [])
    flagged = [s for s in segs if any(f["code"] != "verify-number" for f in s.get("flags", []))]
    numbers = [s for s in segs if any(f["code"] == "verify-number" for f in s.get("flags", []))]
    machine = transcript.get("engine") in ("whisper", "arabic-transcribe")
    lines = ["## Read this first", ""]
    if machine:
        lines.append(f"- Drafted from a machine transcript ({transcript.get('model')}). "
                     f"{len(flagged)} of {len(segs)} segments are flagged for checking against the audio.")
        if transcript.get("speed", 1) != 1:
            lines.append(f"- The recording was saved at {transcript['speed']}x and slowed back to normal speed; "
                         "times are on the original meeting clock.")
        if transcript.get("pace", 1) != 1:
            lines.append(f"- Speech was fed to the model at {transcript['pace']}x pace; times are rescaled to the meeting clock.")
        if transcript.get("speed_hint"):
            lines.append(f"- {transcript['speed_hint']}.")
    else:
        lines.append(f"- Drafted from an existing transcript or notes ({transcript.get('kind', 'notes')}).")
    lines.append(f"- {len(numbers)} segments contain numbers; every number below is confirmed before issue.")
    lines.append("- Nothing was invented to fill a gap. Unknowns say “Not stated” or “TBC – requires assignment”.")
    return "\n".join(lines) + "\n"


def management_summary(found, meta):
    tbc = sum(1 for a in found["actions"] if a["owner"].startswith("TBC"))
    no_date = sum(1 for a in found["actions"] if not a.get("due"))
    rows = [
        ("Overall status", meta.get("overall") or "To be set by the chair (RAG with one-line rationale)"),
        ("Business objective", meta.get("objective") or "Not set – name the objective or impact this meeting serves"),
        ("Decisions taken", len(found["decisions"])),
        ("Decisions required", len(found["questions"])),
        ("Actions", f"{len(found['actions'])} ({tbc} without an owner, {no_date} without a date)"),
        ("Issues raised", f"{len(found['issues'])} ({sum(1 for i in found['issues'] if i['root_cause'].startswith('Not established'))} without a root cause)"),
        ("Scope changes", len(found["scope"])),
        ("Conflicts recorded", len(found["conflicts"])),
    ]
    return "## Management summary\n\n" + table(["Item", "Position"], rows)


def participants(meta, transcript):
    listed = meta.get("attendees") or []
    heard = [name for name, _ in speakers(transcript.get("segments", []))]
    rows = [(n, "Listed", "Yes" if n in heard else "Not heard") for n in listed]
    rows += [(n, "Not on the list", "Yes") for n in heard if n not in listed]
    return "## Participants\n\n" + table(["Name", "Attendance list", "Heard speaking"], rows)


def decisions(found, meta):
    rows = [(d["id"], d["text"], meta.get("date"), d["owner"] or NOT_STATED, d["ref"],
             "Needs confirming" if d["flags"] else "Stated") for d in found["decisions"]]
    return "## Decisions\n\n" + table(["#", "Decision", "Date", "Owner", "Source", "Basis"], rows)


def actions(found):
    rows = [(a["id"], a["text"], a["owner"], due_text(a.get("due")), "Not set", a["status"], a["ref"])
            for a in found["actions"]]
    return "## Actions\n\n" + table(["#", "Action", "Owner", "Due", "Priority", "Status", "Source"], rows)


def issues(found):
    rows = [(i["id"], i["text"], i["root_cause"], "TBC", "TBC", "Not stated", i["ref"]) for i in found["issues"]]
    return ("## Open issues and root cause\n\n"
            + table(["#", "Issue", "Root cause", "Corrective action", "Preventive action", "Deadline", "Source"], rows))


def conflicts(found):
    rows = [(c["id"], c["speaker"] or NOT_STATED, c["text"], c["ref"]) for c in found["conflicts"]]
    return ("## Conflicts recorded\n\nWhere two parties gave different accounts, both are recorded and neither is treated "
            "as correct until the chair decides.\n\n" + table(["#", "Who", "What was said", "Source"], rows))


def requirements(found):
    if not found["requirements"] and not found["scope"]:
        return ""
    req = [(r["id"], r["story"], r["ref"]) for r in found["requirements"]]
    cr = [(c["id"], c["text"], c["note"], c["ref"]) for c in found["scope"]]
    return ("## Requirements and scope raised\n\n" + table(["#", "Draft story (role and value to confirm)", "Source"], req)
            + "\n" + table(["#", "New request", "Control", "Source"], cr))


def to_confirm(found, transcript):
    """One consolidated request pack: every open question, grouped by who must answer."""
    items = []
    for q in found["questions"]:
        items.append((q["speaker"] or "Chair", q["text"], q["ref"]))
    for a in found["actions"]:
        if a["owner"].startswith("TBC"):
            items.append(("Chair", f"Who owns {a['id']}: {a['text']}", a["ref"]))
        elif not a.get("due"):
            items.append((a["owner"], f"Due date for {a['id']}: {a['text']}", a["ref"]))
    for s in transcript.get("segments", []):
        codes = [f["code"] for f in s.get("flags", []) if f["code"] != "verify-number"]
        if codes:
            items.append(("Minute-taker", f"Check against the audio ({', '.join(codes)})", _ref(s)))
    items.sort(key=lambda i: i[0])
    return ("## To confirm before sending\n\nOne request per person, sent once, with a reply-by date.\n\n"
            + table(["Ask", "Question", "Source"], items))


def _ref(seg):
    from .extract import stamp
    return stamp(seg)


def as_written(found, transcript, limit=400):
    lines = ["## Discussion – as written", ""]
    for s in transcript.get("segments", [])[:limit]:
        who = f"**{s['speaker']}:** " if s.get("speaker") else ""
        mark = " ⚑" if s.get("flags") and any(f["code"] != "verify-number" for f in s["flags"]) else ""
        lines.append(f"- `{_ref(s)}` {who}{s['text']}{mark}")
    if len(transcript.get("segments", [])) > limit:
        lines.append(f"- … {len(transcript['segments']) - limit} more segments in the transcript tab")
    return "\n".join(lines) + "\n"


def pmo_judgement(found):
    if not found["pmo"]:
        return ""
    return ("## PMO judgement (not agreed in the meeting)\n\n"
            + "\n".join(f"- {p['text']} (`{p['ref']}`)" for p in found["pmo"]) + "\n")


def footer(meta):
    who = meta.get("author") or "Minute-taker"
    validator = meta.get("validator")
    status = f"Draft minutes for review with {validator} before issue" if validator else "Draft minutes – not yet validated"
    return f"---\n\n_{status}. Prepared by {who}._\n"


# --------------------------------------------------------------------------- template-specific

def tickets_section(found, transcript):
    seen = {}
    for s in transcript.get("segments", []):
        for num in TICKET.findall(s.get("text", "")):
            seen.setdefault(num, []).append(s)
    rows = []
    for num, segs in seen.items():
        acts = [a for a in found["actions"] if f"#{num}" in a["text"].replace("# ", "#")]
        owner = acts[0]["owner"] if acts else NOT_STATED
        due = due_text(acts[0].get("due")) if acts else "Date not stated"
        rows.append((f"#{num}", " / ".join(x["text"] for x in segs[:2]), owner, due, _ref(segs[0])))
    return "## Tickets discussed\n\n" + table(["Ticket", "Discussion and recorded outcome", "Owner", "Due", "Source"], rows)


def committee_register(found):
    rows = [(d["id"], "Decision", d["text"], d["owner"] or NOT_STATED, "Closed", "") for d in found["decisions"]]
    rows += [(i["id"], "Issue", i["text"], NOT_STATED, "Open", "") for i in found["issues"]]
    rows += [(c["id"], "New request", c["text"], NOT_STATED, "Not started", "") for c in found["scope"]]
    return ("## Agenda register\n\n" + table(["#", "Type", "Item and committee decision", "Task owner", "Status", "Due"], rows)
            + "\n## What we need back\n\n" + table(["#", "Ask", "From", "By"],
                                                  [(q["id"], q["text"], q["speaker"] or "Chair", "Not stated")
                                                   for q in found["questions"]]))


def steering_tables(found):
    numeric = [a for a in found["decisions"] + found["actions"] + found["issues"] if "verify-number" in a["flags"]]
    a_rows = [(n["text"], "Was: TBC", "Now: TBC", n["ref"]) for n in numeric]
    b_rows = [(a["text"], "TBC", "TBC", due_text(a.get("due")), a["owner"]) for a in found["actions"]]
    return ("## Table A – KPIs moved\n\n" + table(["KPI", "Was", "Now", "Source"], a_rows)
            + "\n## Table B – Gaps\n\n" + table(["Gap", "Today", "Target", "Due", "Owner"], b_rows)
            + "\n## For decision\n\n" + table(["#", "Decision needed", "From", "Needed by"],
                                              [(q["id"], q["text"], q["speaker"] or "Chair", "Not stated")
                                               for q in found["questions"]]))


def lecture_sections(found, transcript):
    points = [s["text"] for s in transcript.get("segments", []) if len(s.get("text", "").split()) >= 12][:15]
    return ("## Key points\n\n" + "\n".join(f"- {p}" for p in points) + "\n\n## Questions raised\n\n"
            + (table(["#", "Question", "Source"], [(q["id"], q["text"], q["ref"]) for q in found["questions"]])))


def chat_digest(found, transcript):
    days = {}
    for s in transcript.get("segments", []):
        day = (s.get("at") or "")[:10]
        days.setdefault(day, 0)
        days[day] += 1
    rows = [(d, n) for d, n in sorted(days.items())]
    return "## Activity by day\n\n" + table(["Day", "Messages"], rows)


# --------------------------------------------------------------------------- build

def build(template, meta, transcript, found, naming=None):
    template = template if template in TEMPLATES else "recording"
    parts = [f"# {meta.get('title') or 'Meeting minutes'}", f"_{meta.get('area', 'PMO')} · {TEMPLATES[template]}_",
             document_control(meta, transcript, template), read_this_first(transcript), management_summary(found, meta)]
    if template not in ("chat-digest", "lecture"):
        parts.append(participants(meta, transcript))
    parts += _middle(template, meta, transcript, found)
    parts += [to_confirm(found, transcript), pmo_judgement(found)]
    body = apply_naming("\n\n".join(p for p in parts if p), naming)
    # The speaker's own words stay as said; the naming rule applies to the minutes, not the quotes.
    tail = [as_written(found, transcript)] if template != "steering" else []
    return "\n\n".join([body, *tail, footer(meta)])


def _middle(template, meta, transcript, found):
    if template == "lecture":
        return [lecture_sections(found, transcript)]
    if template == "steering":
        return [steering_tables(found), decisions(found, meta), actions(found)]
    middle = []
    if template == "ticket":
        middle.append(tickets_section(found, transcript))
    if template == "committee":
        middle.append(committee_register(found))
    if template == "chat-digest":
        middle.append(chat_digest(found, transcript))
    middle += [decisions(found, meta), actions(found), issues(found)]
    if template != "follow-up":
        middle += [conflicts(found), requirements(found)]
    return middle

"""Offline extraction: transcript -> decisions, actions, issues, conflicts, requirements, questions.

Cue lexicons cover English, Egyptian Arabic, Gulf/Saudi Arabic and MSA. Nothing is invented:
an owner is only set when the speaker named someone, a due date only when one was said, and a
relative date ("بكرة", "next week") is resolved against the meeting date and marked as resolved.

Skills applied here:
- eliciting-business-needs  every issue gets a root-cause line; "not established" when nobody said why
- structuring-requirements  needs voiced in the meeting become draft stories with role/value TBC
- validating-project-scope  new requests are flagged as scope changes needing a change request
- pmo-raid-log              actions carry Owner · Due · Status; TBC owners stay visible
"""

import re
from datetime import date, datetime, timedelta

from .arabic import normalise

DECISION = ["agreed", "we agreed", "decided", "decision", "approved", "approve", "we will go with", "resolution",
            "اتفقنا", "تم الاتفاق", "متفقين", "قررنا", "تقرر", "القرار", "تمت الموافقه", "وافق", "موافقه",
            "اعتماد", "اعتمدنا", "تم اعتماد", "خلاص هنمشي", "استقرينا", "اتفقنا ان", "تم التوجيه"]
ACTION = ["action", "i will", "we will", "i'll", "we'll", "will send", "will share", "will prepare", "will update", "will check", "will follow",
          "to follow up", "follow up", "please", "kindly", "needs to", "need to", "assigned", "by eod",
          "لازم", "مطلوب", "يرجى", "برجاء", "رجاء", "ياريت", "هيعمل", "هتعمل", "هنعمل", "حيعمل", "هيبعت",
          "هتبعت", "هيجهز", "هيرفع", "هيسلم", "هيتابع", "هتتابع", "هيراجع", "هنراجع", "سيقوم", "يتولى",
          "يتابع", "متابعه", "راح يسوي", "بيسوي", "بنسوي", "راح نسوي", "يسوي", "يرسل", "يبعت", "يجهز",
          "يرفع", "تسليم", "يسلم", "ارسال", "نرفع", "اعمل", "ابعت", "ابعتلي", "ابعتو", "شوف"]
ISSUE = ["issue", "problem", "blocker", "blocked", "bug", "delay", "delayed", "risk", "down", "not working",
         "escalat", "مشكله", "مشاكل", "عطل", "واقف", "متاخر", "تاخير", "اتاخر", "مش شغال", "مبيشتغلش",
         "خطر", "مخاطره", "تصعيد", "ما يشتغل", "خربان", "معطل", "شكوى", "خطا", "ايرور", "error"]
CAUSE = ["because", "root cause", "due to", "caused by", "the reason", "since the",
         "السبب", "بسبب", "عشان", "علشان", "لان", "نتيجه", "سببه", "من ورا"]
CONFLICT = ["disagree", "not agree", "but the team says", "but qa", "but dev", "contradict", "objection",
            "مش موافق", "مختلف", "معترض", "اعترض", "بس الفريق", "بس التيم", "بس الكيو", "لكن الفريق",
            "لكن التيم", "مش صح", "غلط", "الكلام ده مش"]
REQUIREMENT = ["we need", "we want", "should be able", "requirement", "the system should", "must be able",
               "عايزين", "عاوزين", "محتاجين", "نبغى", "نبي", "نحتاج", "المطلوب ان", "المطلوب إن", "لازم السيستم",
               "لازم النظام", "يكون فيه", "يبقى فيه"]
SCOPE = ["new request", "new feature", "change request", "out of scope", "scope", "additional",
         "طلب جديد", "فيتشر جديده", "خارج النطاق", "اضافه جديده", "تغيير في", "مش من ضمن", "سكوب"]
QUESTION = ["?", "؟", "not clear", "to confirm", "tbc", "مش واضح", "محتاجين نعرف", "مين المسؤول", "امتى"]
FIRST_PERSON = ("i will", "i'll", "i can", "هعمل", "هبعت", "هجهز", "هراجع", "هتابع", "هرفع", "هسلم", "راح اسوي", "بسوي", "سأقوم")
PMO_NOTE = ("my conclusion", "pmo:", "as pmo", "pmo note", "رأيي كـ pmo", "ملاحظه pmo")

_N = {k: [normalise(c) for c in v] for k, v in {
    "decision": DECISION, "action": ACTION, "issue": ISSUE, "cause": CAUSE, "conflict": CONFLICT,
    "requirement": REQUIREMENT, "scope": SCOPE, "question": QUESTION}.items()}

WEEKDAYS = {"sunday": 6, "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3, "friday": 4, "saturday": 5,
            "الاحد": 6, "الحد": 6, "الاتنين": 0, "الاثنين": 0, "التلات": 1, "الثلاثاء": 1, "التلاتاء": 1,
            "الاربع": 2, "الاربعاء": 2, "الخميس": 3, "الجمعه": 4, "السبت": 5}
RELATIVE = [("بعد بكره", 2), ("بعد بكرا", 2), ("بكره", 1), ("بكرا", 1), ("باكر", 1), ("tomorrow", 1),
            ("today", 0), ("النهارده", 0), ("اليوم", 0), ("eod", 0), ("الاسبوع الجاي", 7), ("الاسبوع القادم", 7),
            ("next week", 7), ("الشهر الجاي", 30), ("next month", 30)]
DATE = re.compile(r"\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b")
MENTION = re.compile(r"@~?([\w؀-ۿ]+(?:\s[\w؀-ۿ]+)?)")
VOCATIVE = re.compile(r"(?:^|\s)يا\s+(?:(?:دكتور|د\.?|م\.?|بشمهندس|مهندس|استاذ|أستاذ|eng\.?|dr\.?)\s+)?([\w؀-ۿ]{2,})")


def has(text_norm, kind):
    return any(c in text_norm for c in _N[kind])


def stamp(seg):
    if seg.get("start") is not None:
        s = int(seg["start"])
        return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60:02d}:{s % 60:02d}"
    if seg.get("at"):
        return seg["at"].replace("T", " ")
    return f"line {seg['line']}" if seg.get("line") else ""


def sentences(segments):
    """Split segments into sentences, keeping the source reference and speaker."""
    out = []
    for seg in segments:
        for part in re.split(r"(?<=[.!?؟])\s+|\n+", seg.get("text", "")):
            part = part.strip(" -•\t")
            if len(MENTION.sub("", part).split()) >= 3:
                out.append({"text": part, "ref": stamp(seg), "speaker": seg.get("speaker", ""),
                            "flags": [f["code"] for f in seg.get("flags", [])], "at": seg.get("at")})
    return out


def resolve_due(text, meeting_day):
    norm = normalise(text)
    m = DATE.search(norm)
    if m:
        return _explicit_date(m, meeting_day)
    for word, days in RELATIVE:
        if normalise(word) in norm:
            return {"date": (meeting_day + timedelta(days=days)).isoformat(), "said": word, "resolved": True}
    for word, wd in WEEKDAYS.items():
        if re.search(rf"(?:^|\s)(?:يوم\s+|by\s+|on\s+|قبل\s+)?{re.escape(normalise(word))}(?:\s|$)", norm):
            ahead = (wd - meeting_day.weekday()) % 7 or 7
            return {"date": (meeting_day + timedelta(days=ahead)).isoformat(), "said": word, "resolved": True}
    return None


def _explicit_date(m, meeting_day):
    d, mo, y = int(m.group(1)), int(m.group(2)), m.group(3)
    year = int(y) + (2000 if y and len(y) == 2 else 0) if y else meeting_day.year
    try:
        return {"date": date(year, mo, d).isoformat(), "said": m.group(0), "resolved": False}
    except ValueError:
        return None


def find_owner(sentence, people):
    """A named person from the attendee list, an @mention, a vocative 'يا فلان', or the speaker
    when they commit themselves ("I will…", "هبعت…"). Never guessed."""
    text = sentence["text"]
    norm = normalise(text)
    if sentence.get("speaker") and norm.startswith(tuple(normalise(f) for f in FIRST_PERSON)):
        return sentence["speaker"]
    for person in people:
        for alias in [person["name"], *person.get("aliases", [])]:
            if alias and normalise(alias) in norm:
                return person["name"]
    m = MENTION.search(text) or VOCATIVE.search(text)
    return m.group(1).strip() if m else ""


def with_attendees(people, attendees):
    """Attendees are owners too; their first name counts as an alias ("Omar" -> "Omar Khaled")."""
    known = {p["name"] for p in people}
    extra = [{"name": a, "aliases": [a.split()[0]] if len(a.split()) > 1 else []}
             for a in attendees or [] if a not in known]
    return list(people) + extra


def extract(segments, meeting_day=None, people=None, attendees=None):
    meeting_day = meeting_day or date.today()
    people = with_attendees(people or [], attendees)
    found = {k: [] for k in ("decisions", "actions", "issues", "conflicts", "requirements", "scope", "questions", "pmo")}
    for i, s in enumerate(sentences(segments)):
        s["index"] = i
        _classify(s, found, meeting_day, people)
    for kind, prefix in (("decisions", "D"), ("actions", "A"), ("issues", "I"), ("requirements", "R"),
                         ("scope", "CR"), ("conflicts", "C"), ("questions", "Q")):
        for i, item in enumerate(found[kind], 1):
            item["id"] = f"{prefix}{i}"
    return found


def _classify(s, found, meeting_day, people):
    norm = normalise(s["text"])
    if norm.startswith(tuple(normalise(p) for p in PMO_NOTE)):
        found["pmo"].append(s)
        return
    base = {"text": s["text"], "ref": s["ref"], "speaker": s["speaker"], "flags": s["flags"]}
    if has(norm, "decision"):
        found["decisions"].append(dict(base, owner=find_owner(s, people), basis="stated"))
    if has(norm, "action") or MENTION.search(s["text"]):
        due = resolve_due(s["text"], meeting_day)
        found["actions"].append(dict(base, owner=find_owner(s, people) or "TBC – requires assignment",
                                     due=due, status="Open"))
    _classify_issue(s, norm, base, found["issues"])
    if has(norm, "conflict"):
        found["conflicts"].append(base)
    if has(norm, "requirement"):
        found["requirements"].append(dict(base, story=f"As a [role TBC], I want {s['text']}, so that [value TBC]"))
    if has(norm, "scope"):
        found["scope"].append(dict(base, note="Change request needed before work starts"))
    if has(norm, "question") and not has(norm, "decision"):
        found["questions"].append(base)


def _classify_issue(s, norm, base, issues):
    if has(norm, "issue"):
        issues.append(dict(base, index=s["index"],
                           root_cause=s["text"] if has(norm, "cause") else "Not established in the meeting"))
    elif has(norm, "cause"):
        _attach_cause(issues, s)


def _attach_cause(issues, s):
    """A reason given within two sentences of an open issue is that issue's stated root cause."""
    if issues and issues[-1]["root_cause"].startswith("Not established") and s["index"] - issues[-1]["index"] <= 2:
        issues[-1]["root_cause"] = f"{s['text']} ({s['speaker'] or 'speaker'}, {s['ref']})"


def speakers(segments):
    counts = {}
    for seg in segments:
        if seg.get("speaker"):
            counts[seg["speaker"]] = counts.get(seg["speaker"], 0) + 1
    return sorted(counts.items(), key=lambda kv: -kv[1])


def parse_day(value):
    try:
        return datetime.fromisoformat(value).date() if value else date.today()
    except ValueError:
        return date.today()

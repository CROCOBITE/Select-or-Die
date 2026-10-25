"""Governance checks on transcripts and minutes.

- transcript flags: known Whisper hallucinations, repetition loops, impossible speech rates,
  low word confidence, numbers and names that must be checked before they are minuted;
- redaction before anything leaves the machine;
- the naming rule for written minutes;
- WER / CER for the pilot that decides which model to trust.
"""

import re

from .arabic import normalise, tokens, western_digits

# Phrases Whisper is known to invent on silence or music in Arabic audio (subtitle credits,
# channel outros). A segment that contains one is flagged, never silently dropped.
HALLUCINATIONS = [
    "ترجمة نانسي قنقر", "نانسي قنقر", "اشتركوا في القناة", "اشترك في القناة", "لا تنسوا الاشتراك", "اشتركوا اشتركوا",
    "شكرا للمشاهدة", "شكرا على المشاهدة", "ترجمة وتدقيق", "سبحان الله وبحمده",
    "thanks for watching", "subscribe to", "subtitles by", "amara.org",
]
_HALLU_NORM = [normalise(h) for h in HALLUCINATIONS]

NUMBER_WORDS = ["واحد", "اتنين", "اثنين", "تلاته", "ثلاثه", "اربعه", "خمسه", "سته", "سبعه",
                "تمانيه", "ثمانيه", "تسعه", "عشره", "عشرين", "تلاتين", "ثلاثين", "ميه", "مية", "الف",
                "مليون", "بالميه", "percent"]


def segment_flags(seg):
    """Return a list of {code, note} for one transcript segment."""
    text = seg.get("text", "")
    norm = normalise(text)
    flags = []
    if any(h in norm for h in _HALLU_NORM):
        flags.append({"code": "hallucination", "note": "Known Whisper filler phrase – check against the audio"})
    if _repetition_loop(norm) or re.search(r"(.)\1{7,}", norm):
        flags.append({"code": "repetition", "note": "Repeated words – likely a decoding loop"})
    rate = _chars_per_second(seg)
    if rate is not None and rate > 28:
        flags.append({"code": "rate", "note": f"{rate:.0f} characters per second is faster than speech"})
    low = [w["word"] for w in seg.get("words", []) if w.get("score") is not None and w["score"] < 0.5]
    if low:
        flags.append({"code": "low-confidence", "note": "Low-confidence words: " + " ".join(low[:8])})
    if _has_number(text):
        flags.append({"code": "verify-number", "note": "Contains a number – confirm before minuting"})
    return flags


def _repetition_loop(norm):
    words = norm.split()
    if len(words) < 6:
        return False
    run = 1
    for a, b in zip(words, words[1:]):
        run = run + 1 if a == b else 1
        if run >= 4:
            return True
    grams = [" ".join(words[i:i + 3]) for i in range(len(words) - 2)]
    return any(grams.count(g) >= 3 for g in set(grams))


def _chars_per_second(seg):
    dur = (seg.get("end") or 0) - (seg.get("start") or 0)
    text = re.sub(r"\s", "", seg.get("text", ""))
    return len(text) / dur if dur >= 2 and text else None


def _has_number(text):
    if re.search(r"\d", western_digits(text)):
        return True
    words = set(tokens(text))
    return any(normalise(n) in words for n in NUMBER_WORDS)


def flag_transcript(segments):
    for seg in segments:
        seg["flags"] = segment_flags(seg)
    return segments


# --------------------------------------------------------------------------- redaction

REDACTIONS = [
    ("email", re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")),
    ("phone", re.compile(r"(?:\+|00)\d[\d\s-]{7,}\d")),                    # international form
    ("phone", re.compile(r"\b0(?:5\d|1[0-25])[\d\s-]{6,9}\d\b")),            # KSA / UAE 05x, Egypt 01x
    ("national-id", re.compile(r"\b[23]\d{13}\b")),                          # Egyptian national ID (14)
    ("national-id", re.compile(r"\b[12]\d{9}\b")),                           # Saudi ID / Iqama (10)
    ("record-number", re.compile(r"\b(?:MRN|mrn|ملف|رقم الملف)\s*[:#]?\s*\d{4,}\b")),
    ("iban", re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b")),
]


def redact(text):
    """Mask contact details and identifiers. Returns (text, counts)."""
    text = western_digits(text or "")
    counts = {}
    for label, pattern in REDACTIONS:
        text, n = pattern.subn(f"[{label}]", text)
        if n:
            counts[label] = counts.get(label, 0) + n
    return text, counts


# --------------------------------------------------------------------------- naming rule

NAMING = [
    (re.compile(r"\bAzure\s+DevOps\b|\bADO\b|\bTFS\b|ديف\s?اوبس|ديف\s?أوبس|الديفوبس|الأزور|الازور", re.I), "DevOps"),
    (re.compile(r"\bCRM\b|سي\s?ار\s?ام|سي\s?آر\s?إم", re.I), "Tickets System"),
]


def apply_naming(text, extra=None):
    for pattern, written in NAMING:
        text = pattern.sub(written, text)
    for spoken, written in (extra or {}).items():
        text = re.sub(re.escape(spoken), written, text, flags=re.I)
    return text


# --------------------------------------------------------------------------- WER / CER

def _edit_distance(a, b):
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[-1]


def error_rates(reference, hypothesis):
    """Word and character error rate after Arabic normalisation (both 0..1+)."""
    ref_w, hyp_w = tokens(reference), tokens(hypothesis)
    ref_c = list(normalise(reference).replace(" ", ""))
    hyp_c = list(normalise(hypothesis).replace(" ", ""))
    wer = _edit_distance(ref_w, hyp_w) / max(len(ref_w), 1)
    cer = _edit_distance(ref_c, hyp_c) / max(len(ref_c), 1)
    return {"wer": round(wer, 4), "cer": round(cer, 4), "ref_words": len(ref_w), "hyp_words": len(hyp_w)}

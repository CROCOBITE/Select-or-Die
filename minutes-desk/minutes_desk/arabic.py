"""Arabic text helpers: matching normalisation, digits, script detection.

Normalisation here is for *matching only* (cue words, names, WER). Text shown to people keeps
the speaker's own spelling; dialect is never rewritten into MSA.
"""

import re

DIACRITICS = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭ]")
TATWEEL = "ـ"
ARABIC_CHARS = re.compile(r"[؀-ۿ]")
ARABIC_INDIC = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
LETTER_MAP = str.maketrans({
    "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا",
    "ى": "ي", "ئ": "ي", "ؤ": "و", "ة": "ه",
    "گ": "ك", "چ": "ج", "ڤ": "ف", "پ": "ب",
})


def has_arabic(text):
    return bool(ARABIC_CHARS.search(text or ""))


def western_digits(text):
    return (text or "").translate(ARABIC_INDIC)


def normalise(text):
    """Lower-case, strip diacritics/tatweel, unify alef/ya/ta-marbuta, western digits."""
    text = western_digits(text or "")
    text = DIACRITICS.sub("", text).replace(TATWEEL, "")
    return re.sub(r"\s+", " ", text.translate(LETTER_MAP).lower()).strip()


def tokens(text):
    return re.findall(r"[\w؀-ۿ]+", normalise(text))


def direction(text):
    """'rtl' when Arabic letters outnumber Latin letters, else 'ltr'."""
    ar = len(ARABIC_CHARS.findall(text or ""))
    latin = len(re.findall(r"[A-Za-z]", text or ""))
    return "rtl" if ar > latin else "ltr"

"""Configuration: defaults merged with the private workspace/config.json."""

import copy
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKSPACE = Path(os.environ.get("MINUTES_DESK_WORKSPACE", ROOT / "workspace")).resolve()

# Whisper-family models from the Hugging Face hub. Licences were read from each model card;
# a model without a stated licence is listed but marked so nobody adopts it by accident.
MODELS = [
    {"id": "oddadmix/whisper-medium-arabic-dialectal", "label": "Mixed dialects (Egyptian, Levantine, Gulf) – medium",
     "dialects": ["egyptian", "gulf", "mixed"], "size": "medium", "licence": "apache-2.0", "cpu_ok": True},
    {"id": "MAdel121/whisper-small-egyptian-arabic", "label": "Egyptian – small, fastest on CPU",
     "dialects": ["egyptian"], "size": "small", "licence": "mit", "cpu_ok": True},
    {"id": "AbdelrahmanHassan/whisper-large-v3-egyptian-arabic", "label": "Egyptian – large-v3 (MGB-3)",
     "dialects": ["egyptian"], "size": "large", "licence": "apache-2.0", "cpu_ok": False},
    {"id": "wageehkhad/whisper-medium-finetuned-sada-asr", "label": "Saudi / Gulf – medium (SADA22)",
     "dialects": ["gulf", "saudi"], "size": "medium", "licence": "apache-2.0", "cpu_ok": True},
    {"id": "mesoj8/whisper-large-v3-arabic-dialect-30s", "label": "Mixed dialects – large-v3 (licence not stated)",
     "dialects": ["mixed"], "size": "large", "licence": None, "cpu_ok": False},
    {"id": "openai/whisper-large-v3", "label": "Baseline – MSA and English (vanilla Whisper)",
     "dialects": ["msa", "english"], "size": "large", "licence": "apache-2.0", "cpu_ok": False},
    {"id": "openai/whisper-small", "label": "Baseline – small (testing only)",
     "dialects": ["msa", "english"], "size": "small", "licence": "apache-2.0", "cpu_ok": True},
]

DEFAULTS = {
    "host": "127.0.0.1",
    "port": 4330,
    "language": "ar",
    "dialect": "mixed",
    "engine": "auto",            # auto | whisper | arabic-transcribe
    "model": "",                 # empty = pick from MODELS by device and dialect
    "chunk_seconds": 25,
    "delete_media_after_transcript": True,
    "max_upload_mb": 4096,
    "claude": {"model": "claude-opus-5-5", "effort": "high", "max_tokens": 32000},
    "skills_dir": "",            # folder of SKILL.md files used in the Claude drafting prompt
    "skills_for_minutes": [],    # folder names inside skills_dir, in order
    "skill_aliases": {},         # neutral skill id -> folder name in skills_dir
    "audiences": {},             # name -> {"template": ..., "distribution": [...], "chair": ..., "validator": ...}
    "people": [],                # known attendees: {"name": ..., "role": ..., "aliases": [...]}
    "naming": {},                # extra spoken-name -> written-name rules
    "author": "",                # byline on exports
    "area": "PMO",               # eyebrow on exports
}


def _merge(base, extra):
    out = copy.deepcopy(base)
    for key, value in (extra or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _merge(out[key], value)
        else:
            out[key] = value
    return out


def load():
    path = WORKSPACE / "config.json"
    extra = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    cfg = _merge(DEFAULTS, extra)
    if cfg["skills_dir"] and not Path(cfg["skills_dir"]).is_absolute():
        cfg["skills_dir"] = str((ROOT / cfg["skills_dir"]).resolve())
    if not cfg["skills_dir"]:
        sibling = ROOT.parent / "phase-zero" / "workspace" / "skills"
        cfg["skills_dir"] = str(sibling) if sibling.exists() else ""
    return cfg


def pick_model(device, dialect, preferred=""):
    if preferred:
        return preferred
    gpu = device in ("cuda", "mps")
    for m in MODELS:
        if m["licence"] and dialect in m["dialects"] and (gpu or m["cpu_ok"]):
            if gpu and m["size"] != "large" and any(
                    x["licence"] and x["size"] == "large" and dialect in x["dialects"] for x in MODELS):
                continue
            return m["id"]
    return "oddadmix/whisper-medium-arabic-dialectal"

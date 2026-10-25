"""Transcription engines. Every engine returns the same shape:

    {"language": "ar", "engine": ..., "model": ..., "device": ...,
     "segments": [{"start": s, "end": s, "text": "...", "words": [...optional...]}]}

- whisper            Hugging Face transformers + a Whisper dialect fine-tune (any OS, CPU or GPU)
- arabic-transcribe  ssagga/arabic-transcribe, if installed on this machine (Cohere Transcribe Arabic +
                     WhisperX alignment; macOS/Linux or Windows through WSL)
"""

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from . import config, media

ARABIC_TRANSCRIBE = Path.home() / ".agents/skills/arabic-transcribe/scripts/transcribe_ar.py"


def device():
    if importlib.util.find_spec("torch") is None:
        return "none"
    import torch
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def doctor():
    """What this machine can run, and the fix for anything missing."""
    have = {name: importlib.util.find_spec(name) is not None
            for name in ("torch", "transformers", "numpy", "anthropic")}
    dev = device()
    checks = [
        _check("ffmpeg", bool(media.ffmpeg_path()), "Install ffmpeg and put it on PATH (winget install ffmpeg / brew install ffmpeg)"),
        _check("numpy", have["numpy"], "pip install -r requirements-asr.txt"),
        _check("torch", have["torch"], "pip install -r requirements-asr.txt"),
        _check("transformers", have["transformers"], "pip install -r requirements-asr.txt"),
        _check("GPU", dev in ("cuda", "mps"), "Optional. Without a GPU use a small or medium model; expect ~1–2x the audio length"),
        _check("arabic-transcribe", ARABIC_TRANSCRIBE.exists(),
               "Optional, best Saudi-dialect accuracy: install ssagga/arabic-transcribe (macOS/Linux/WSL)"),
        _check("anthropic", have["anthropic"], "Optional, for Claude drafts: pip install -r requirements-ai.txt"),
        _check("API key", bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")),
               "Optional: set ANTHROPIC_API_KEY or run 'ant auth login'"),
    ]
    return {"device": dev, "checks": checks, "engines": available_engines(),
            "python": sys.version.split()[0], "platform": sys.platform}


def _check(name, ok, fix):
    return {"name": name, "ok": ok, "fix": "" if ok else fix}


def available_engines():
    engines = []
    if importlib.util.find_spec("transformers") and importlib.util.find_spec("torch"):
        engines.append("whisper")
    if ARABIC_TRANSCRIBE.exists():
        engines.append("arabic-transcribe")
    return engines


def choose(cfg, requested=""):
    engine = requested or cfg["engine"]
    if engine != "auto":
        return engine
    have = available_engines()
    if "arabic-transcribe" in have and cfg["dialect"] in ("gulf", "saudi"):
        return "arabic-transcribe"
    return "whisper" if "whisper" in have else (have[0] if have else "none")


def transcribe(path, cfg, engine="", model="", progress=lambda pct, msg: None, speed=1, pace=1, language=""):
    engine = choose(cfg, engine)
    cfg = dict(cfg, language=language or cfg["language"])
    if engine == "whisper":
        result = _whisper(path, cfg, model, progress, speed, pace)
    elif engine == "arabic-transcribe":
        result = _arabic_transcribe(_restored(path, speed, pace), cfg, progress)
    else:
        raise RuntimeError("No transcription engine is installed – open Doctor for the steps")
    _to_meeting_clock(result["segments"], float(pace or 1))
    result["speed"], result["pace"] = float(speed or 1), float(pace or 1)
    result["speed_hint"] = speed_hint(result["segments"], speed)
    return result


def speed_hint(segments, speed):
    """Natural speech runs at roughly 10–16 characters per second. Much faster after correction
    suggests the file was sped up and the speed setting is wrong."""
    rates = sorted(len(s["text"].replace(" ", "")) / (s["end"] - s["start"])
                   for s in segments if s.get("end") and s.get("start") is not None and s["end"] - s["start"] >= 3)
    if len(rates) < 5:
        return ""
    median = rates[len(rates) // 2]
    if median > 22:
        return f"Speech runs at {median:.0f} characters per second – the file may be sped up; set its speed and transcribe again"
    if median < 6 and float(speed or 1) > 1:
        return f"Speech runs at {median:.0f} characters per second – check the speed setting ({speed}x)"
    return ""


def _to_meeting_clock(segments, pace):
    """Audio fed at a slower pace runs longer; scale times back to the meeting clock."""
    if abs(pace - 1) < 0.01:
        return
    for seg in segments:
        for key in ("start", "end"):
            if seg.get(key) is not None:
                seg[key] = round(seg[key] * pace, 2)
        for w in seg.get("words", []):
            for key in ("start", "end"):
                if w.get(key) is not None:
                    w[key] = round(w[key] * pace, 2)


def _restored(path, speed, pace=1):
    """arabic-transcribe reads a file, so write an adjusted copy when speed or pace is not 1x."""
    if not media.tempo_filter(speed, pace):
        return path
    out = Path(tempfile.mkdtemp(prefix="minutes-desk-")) / "restored.wav"
    subprocess.run([media.ffmpeg_path(), "-v", "error", "-nostdin", "-i", str(path), "-vn", *media.tempo_filter(speed, pace),
                    "-ac", "1", "-ar", str(media.SAMPLE_RATE), str(out)], check=True)
    return out


# --------------------------------------------------------------------------- whisper

_PIPES = {}


def _pipeline(model_id, dev):
    key = (model_id, dev)
    if key not in _PIPES:
        import torch
        from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline

        dtype = torch.float16 if dev == "cuda" else torch.float32
        processor = AutoProcessor.from_pretrained(model_id)
        model = AutoModelForSpeechSeq2Seq.from_pretrained(model_id, low_cpu_mem_usage=True, **_dtype_kw(dtype))
        model.to(dev)
        # device is set on the model; passing device_map *and* device to pipeline() conflicts.
        _PIPES[key] = pipeline("automatic-speech-recognition", model=model, tokenizer=processor.tokenizer,
                               feature_extractor=processor.feature_extractor, device=dev, **_dtype_kw(dtype))
    return _PIPES[key]


def _dtype_kw(dtype):
    import transformers
    major, minor = (int(x) for x in transformers.__version__.split(".")[:2])
    return {"dtype": dtype} if (major, minor) >= (4, 56) else {"torch_dtype": dtype}


def _whisper(path, cfg, model, progress, speed=1, pace=1):
    dev = device()
    model_id = config.pick_model(dev, cfg["dialect"], model or cfg["model"])
    note = f" restoring {speed}x to normal" if float(speed or 1) != 1 else ""
    note += f", fed at {pace}x pace" if float(pace or 1) != 1 else ""
    progress(2, "Decoding audio" + note)
    audio = media.decode(path, speed, pace)
    level = media.loudness(audio)
    if level < media.SILENCE_DBFS:
        raise RuntimeError(f"The recording has no audible speech (average level {level:.0f} dB). "
                           "Whisper invents text on silence, so nothing was transcribed – check the audio track.")
    spans = media.quiet_split_points(audio, media.SAMPLE_RATE, float(cfg["chunk_seconds"]))
    progress(5, f"Loading {model_id} on {dev} (first run downloads the model)")
    pipe = _pipeline(model_id, dev)
    segments = []
    for i, (start, end) in enumerate(spans):
        clip = audio[int(start * media.SAMPLE_RATE):int(end * media.SAMPLE_RATE)]
        # Silent stretches are skipped: Whisper fills them with invented text.
        if len(clip) >= media.SAMPLE_RATE * 0.3 and media.loudness(clip) >= media.SILENCE_DBFS:
            segments.extend(_whisper_chunk(pipe, clip, start, end, cfg["language"]))
        progress(5 + int(93 * (i + 1) / len(spans)), f"Chunk {i + 1} of {len(spans)}")
    return {"language": cfg["language"], "engine": "whisper", "model": model_id, "device": dev,
            "duration": len(audio) / media.SAMPLE_RATE * float(pace or 1), "segments": segments}


# Whisper's own long-form recipe: when a chunk's text compresses too well it is a decoding loop
# ("هاااا…", "نحن نحن نحن…"), so decode again with repeats blocked, then with light sampling.
RETRIES = [{}, {"no_repeat_ngram_size": 4}, {"no_repeat_ngram_size": 4, "do_sample": True, "temperature": 0.4}]


def looped(text):
    import zlib
    raw = text.encode("utf-8")
    return len(raw) > 40 and len(raw) / max(len(zlib.compress(raw)), 1) > 2.4


def _whisper_chunk(pipe, clip, start, end, language):
    # "auto" lets Whisper detect the language of each chunk: better for meetings that switch
    # between Arabic and English. Forcing "ar" tends to write English terms in Arabic script.
    base = {"task": "transcribe"} if language == "auto" else {"language": language, "task": "transcribe"}
    out = {}
    for extra in RETRIES:
        out = _decode(pipe, {"raw": clip.copy(), "sampling_rate": media.SAMPLE_RATE}, dict(base, **extra))
        if not looped(out.get("text", "")):
            break
    parts = out.get("chunks") or [{"timestamp": (0.0, end - start), "text": out.get("text", "")}]
    segs = []
    for part in parts:
        text = (part.get("text") or "").strip()
        if not text:
            continue
        s, e = part.get("timestamp") or (0.0, end - start)
        s = start + (s or 0.0)
        e = start + (e if e is not None else end - start)
        segs.append({"start": round(s, 2), "end": round(min(e, end), 2), "text": text})
    return segs


def _decode(pipe, sample, kwargs):
    try:
        return pipe(dict(sample), return_timestamps=True, generate_kwargs=kwargs)
    except (ValueError, RuntimeError, KeyError, IndexError):
        # Some fine-tunes were trained without timestamp tokens.
        return pipe(dict(sample), generate_kwargs=kwargs)


# --------------------------------------------------------------------------- arabic-transcribe

def _arabic_transcribe(path, cfg, progress):
    progress(3, "Running arabic-transcribe (Cohere Transcribe Arabic + WhisperX alignment)")
    tmp = Path(tempfile.mkdtemp(prefix="minutes-desk-"))
    out = tmp / "out.json"
    try:
        proc = subprocess.run([shutil.which("python3") or sys.executable, str(ARABIC_TRANSCRIBE), str(path),
                               "-o", str(out), "--language", cfg["language"],
                               "--chunk-sec", str(cfg["chunk_seconds"])],
                              capture_output=True, text=True, check=False)
        if proc.returncode != 0:
            raise RuntimeError("arabic-transcribe failed: " + (proc.stderr or proc.stdout)[-400:])
        data = json.loads(out.read_text(encoding="utf-8"))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    progress(98, "Aligned")
    return {"language": data.get("language", cfg["language"]), "engine": "arabic-transcribe",
            "model": "CohereLabs/cohere-transcribe-arabic-07-2026", "device": "local",
            "segments": data.get("segments", [])}

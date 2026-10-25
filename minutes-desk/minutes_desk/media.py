"""Audio and video decoding through ffmpeg, plus quiet-point chunking.

quiet_split_points() is adapted from ssagga/arabic-transcribe (MIT License,
Copyright (c) 2026 Samer Al-Saqqa): a fixed 30-second split cuts whichever word straddles
the boundary, so each cut is moved to the quietest moment within a few seconds of the target.
"""

import json
import shutil
import subprocess

SAMPLE_RATE = 16000
MEDIA_SUFFIXES = {".mp3", ".m4a", ".wav", ".ogg", ".opus", ".aac", ".flac", ".wma", ".amr",
                  ".mp4", ".mov", ".mkv", ".webm", ".avi", ".wmv", ".m4v", ".3gp"}


def ffmpeg_path():
    return shutil.which("ffmpeg")


def probe(path):
    """Duration in seconds and whether the file has an audio stream."""
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return {"duration": None, "audio": None}
    out = subprocess.run([ffprobe, "-v", "error", "-show_entries", "format=duration:stream=codec_type",
                          "-of", "json", str(path)], capture_output=True, text=True, check=False)
    try:
        data = json.loads(out.stdout or "{}")
    except ValueError:
        return {"duration": None, "audio": None}
    streams = [s.get("codec_type") for s in data.get("streams", [])]
    duration = data.get("format", {}).get("duration")
    return {"duration": float(duration) if duration else None, "audio": "audio" in streams}


def tempo_filter(speed, pace=1):
    """speed: the playback speed the file was saved at (1.5x, 2x…) – it is slowed back to normal.
    pace: how fast the restored speech is fed to the model; 0.8 slows it a further 20% for fast,
    mixed Arabic/English talk. Engines multiply timestamps by pace, so times stay on the meeting clock."""
    speed, pace = float(speed or 1), float(pace or 1)
    if not 0.5 <= speed <= 4:
        raise ValueError("Playback speed must be between 0.5x and 4x")
    if not 0.5 <= pace <= 1.2:
        raise ValueError("Recognition pace must be between 0.5x and 1.2x")
    factor = pace / speed
    if abs(factor - 1) < 0.01:
        return []
    factors, rest = [], factor
    while rest < 0.5:
        factors.append(0.5)
        rest /= 0.5
    factors.append(round(rest, 4))
    return ["-af", ",".join(f"atempo={f}" for f in factors)]


def decode(path, speed=1, pace=1):
    """Decode any audio/video file to mono 16 kHz float32 samples (numpy array)."""
    import numpy as np

    ff = ffmpeg_path()
    if not ff:
        raise RuntimeError("ffmpeg is not installed – see README, 'Install on your desk'")
    proc = subprocess.run([ff, "-v", "error", "-nostdin", "-i", str(path), "-vn", *tempo_filter(speed, pace), "-ac", "1",
                           "-ar", str(SAMPLE_RATE), "-f", "s16le", "-"], capture_output=True, check=False)
    if proc.returncode != 0:
        raise RuntimeError("ffmpeg could not read the file: " + proc.stderr.decode("utf-8", "replace")[-300:])
    return np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0


SILENCE_DBFS = -50.0


def loudness(audio):
    """RMS level in dBFS (0 = full scale). Speech in a meeting recording sits around -35 to -15."""
    import numpy as np

    if len(audio) == 0:
        return -120.0
    rms = float(np.sqrt(np.mean(np.square(audio, dtype=np.float64))))
    return 20 * np.log10(max(rms, 1e-6))


def quiet_split_points(audio, sr=SAMPLE_RATE, chunk_sec=25.0, search_sec=3.0, win_ms=300):
    """Chunk spans [(start, end), ...] in seconds, each cut placed at the quietest nearby point."""
    import numpy as np

    total = len(audio) / sr
    if total <= chunk_sec:
        return [(0.0, total)]
    win = max(1, int(win_ms / 1000 * sr))
    hop = max(1, win // 4)
    energy = np.lib.stride_tricks.sliding_window_view(np.abs(audio), win)[::hop].mean(axis=1)
    cuts, target = [0.0], chunk_sec
    while target < total - 1.0:
        cut = _quietest(energy, sr, hop, win, lo=max(cuts[-1] + 2.0, target - search_sec),
                        hi=min(total - 0.5, target + search_sec), default=target)
        cuts.append(cut)
        target = cut + chunk_sec
    cuts.append(total)
    return [(cuts[i], cuts[i + 1]) for i in range(len(cuts) - 1)]


def _quietest(energy, sr, hop, win, lo, hi, default):
    import numpy as np

    i_lo, i_hi = int(lo * sr / hop), min(int(hi * sr / hop), len(energy) - 1)
    if hi <= lo or i_hi <= i_lo:
        return default
    best = int(np.argmin(energy[i_lo:i_hi])) + i_lo
    return (best * hop + win / 2) / sr

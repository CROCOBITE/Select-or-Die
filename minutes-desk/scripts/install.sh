#!/usr/bin/env bash
# One-time setup on macOS / Linux / WSL. Needs python3 (3.10+) and ffmpeg (brew install ffmpeg / apt install ffmpeg).
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements-asr.txt -r requirements-ai.txt
mkdir -p workspace
[ -f workspace/config.json ] || cp config.example.json workspace/config.json
.venv/bin/python -m minutes_desk doctor

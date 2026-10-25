@echo off
rem One-time setup on Windows: Python 3.10+ and ffmpeg must be installed first
rem   winget install Python.Python.3.12
rem   winget install Gyan.FFmpeg
cd /d "%~dp0\.."
python -m venv .venv
.venv\Scripts\python -m pip install --upgrade pip
.venv\Scripts\python -m pip install -r requirements-asr.txt
.venv\Scripts\python -m pip install -r requirements-ai.txt
if not exist workspace mkdir workspace
if not exist workspace\config.json copy config.example.json workspace\config.json
.venv\Scripts\python -m minutes_desk doctor
pause

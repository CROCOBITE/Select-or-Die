@echo off
rem Double-click to start Minutes Desk on Windows. First run: scripts\install-windows.bat
cd /d "%~dp0\.."
if exist .venv\Scripts\python.exe (set PY=.venv\Scripts\python.exe) else (set PY=python)
%PY% -m minutes_desk serve

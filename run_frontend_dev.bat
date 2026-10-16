@echo off
set PATH=%ProgramFiles%\nodejs;%PATH%
cd /d "%~dp0"
call npm.cmd run dev --workspace=frontend -- --host 0.0.0.0

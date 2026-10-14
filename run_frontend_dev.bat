@echo off
set PATH=%ProgramFiles%\nodejs;%PATH%
cd /d C:\workspace\library-management-system\frontend
npm.cmd run dev -- --host 0.0.0.0

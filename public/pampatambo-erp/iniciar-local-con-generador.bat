@echo off
setlocal
cd /d "%~dp0"
set TAMBO_OPEN_GENERATOR=1
npm.cmd run start:auto

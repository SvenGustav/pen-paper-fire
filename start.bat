@echo off
title Pen, Paper, Fire
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is needed for phone controllers. Get it at https://nodejs.org & pause & exit /b 1)
node server.js
pause

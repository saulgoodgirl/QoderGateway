@echo off
title QoderGateway
cd /d "%~dp0"
echo Starting QoderGateway on http://127.0.0.1:5050 ...
.\.venv\Scripts\python.exe -m qoder2api.app
pause

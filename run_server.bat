@echo off
cd /d %~dp0

echo Starting Bridge Server...
start "Bridge Server" cmd /k "node server/index.js"

echo Starting Web Client Dev Server...
start "Web Client Dev Server" cmd /k "cd web-client && npm run dev"

echo Both servers are starting in new windows!
echo Bridge: http://127.0.0.1:%PORT% (default 24141)  Client: http://localhost:3000
echo You can safely close this window.
pause
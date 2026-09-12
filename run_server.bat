@echo off

echo Starting Bridge Server...
start "Bridge Server" cmd /k "node server/index.js"

echo Starting Web Client Dev Server...
start "Web Client Dev Server" cmd /k "cd web-client && npm run dev"

echo Both servers are starting in new windows!
echo You can safely close this window.
pause
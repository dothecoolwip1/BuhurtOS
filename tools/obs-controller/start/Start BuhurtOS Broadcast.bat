@echo off
rem BuhurtOS Broadcast Companion: crash-safe start loop (Windows). Quit on the Companion screen (exit code 64) or closing this window stops it.
rem Any other exit (a crash) starts it again after two seconds.
cd /d "%~dp0"
rem in the repo the launchers live in start\ (dist is one level up); in a shipped zip they sit next to dist\
if not exist dist\companion.mjs cd ..
if not exist dist\companion.mjs (
  echo dist\companion.mjs not found: run npm run build first
  exit /b 2
)
set NODE=node
if exist "%CD%\node\node.exe" set NODE="%CD%\node\node.exe"
:loop
%NODE% dist\companion.mjs
if %ERRORLEVEL%==64 goto done
if %ERRORLEVEL%==0 goto done
echo The Companion exited with code %ERRORLEVEL%. Starting it again in 2 seconds...
timeout /t 2 /nobreak >nul
goto loop
:done
echo The Companion stopped.

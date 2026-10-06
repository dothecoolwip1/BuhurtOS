#!/usr/bin/env bash
# BuhurtOS Broadcast Companion: crash-safe start loop (Linux; macOS uses "Start BuhurtOS Broadcast.command", Windows the .bat).
# Quit from the screen (exit code 64) or Ctrl+C (exit 0) stops the loop. ANY other exit (a crash, a kill) starts the Companion again after a short pause;
# it comes back with the settings, the Camera Off latch and the credentials it saved, and reconciles to the current truth.
HERE="$(cd "$(dirname "$0")" && pwd)"
# in the repo the launchers live in start/ (dist is one level up); in a shipped zip they sit next to dist/
if [ -f "$HERE/dist/companion.mjs" ]; then cd "$HERE" || exit 1; elif [ -f "$HERE/../dist/companion.mjs" ]; then cd "$HERE/.." || exit 1; else echo "dist/companion.mjs not found: run 'npm run build' first"; exit 2; fi
if [ -x ./node/bin/node ]; then NODE=./node/bin/node; else NODE="${COMPANION_NODE:-node}"; fi
DELAY="${COMPANION_RESTART_DELAY:-2}"
while true; do
  "$NODE" dist/companion.mjs
  code=$?
  if [ "$code" -eq 64 ] || [ "$code" -eq 0 ]; then echo "The Companion stopped (exit $code)."; exit 0; fi
  echo "The Companion exited with code $code: starting it again in ${DELAY} s ..."
  sleep "$DELAY"
done

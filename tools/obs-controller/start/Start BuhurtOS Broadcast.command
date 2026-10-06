#!/usr/bin/env bash
# macOS: double-click to start the BuhurtOS Broadcast Companion (it restarts itself if it ever crashes; Quit on its screen stops it).
exec bash "$(dirname "$0")/start-broadcast.sh"

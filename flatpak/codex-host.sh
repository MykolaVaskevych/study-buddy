#!/bin/sh
# Runs the user's Codex CLI on the host from inside the Flatpak sandbox (like claude-host.sh).
exec flatpak-spawn --host --watch-bus sh -lc 'exec codex "$@"' codex "$@"

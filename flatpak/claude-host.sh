#!/bin/sh
# Runs the user's Claude Code on the host (outside the Flatpak sandbox), so Study Buddy can use
# the Claude subscription the user is logged into. A login shell gives the host PATH (~/.local/bin).
exec flatpak-spawn --host --watch-bus sh -lc 'exec claude "$@"' claude "$@"

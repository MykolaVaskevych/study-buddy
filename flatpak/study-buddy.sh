#!/bin/sh
# zypak lets Chromium's sandbox work inside the Flatpak sandbox (Electron BaseApp).
export TMPDIR="$XDG_RUNTIME_DIR/app/$FLATPAK_ID"
exec zypak-wrapper /app/lib/study-buddy/study-buddy "$@"

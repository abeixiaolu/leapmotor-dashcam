#!/bin/zsh
cd "${0:A:h}" || exit 1
export PATH="/opt/homebrew/bin:$HOME/.vite-plus/bin:$PATH"
if curl -fsS http://localhost:5174/ >/dev/null 2>&1; then
  open http://localhost:5174/
  exit 0
fi
exec vp run start

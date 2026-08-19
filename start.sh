#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

# macOS: fix outbound TCP Errno 49 when automatic source address selection breaks
export UTOPIA_BIND_INTERFACE="${UTOPIA_BIND_INTERFACE:-en0}"
export UTOPIA_LIVE_REFRESH_SEC="${UTOPIA_LIVE_REFRESH_SEC:-10}"
export VITE_LIVE_REFRESH_SEC="${VITE_LIVE_REFRESH_SEC:-$UTOPIA_LIVE_REFRESH_SEC}"
export UTOPIA_CHART_REFRESH_SEC="${UTOPIA_CHART_REFRESH_SEC:-30}"
export VITE_CHART_REFRESH_SEC="${VITE_CHART_REFRESH_SEC:-$UTOPIA_CHART_REFRESH_SEC}"

if [[ ! -d "$ROOT/backend/.venv" ]]; then
  uv venv --python 3.12 "$ROOT/backend/.venv"
fi
uv pip install --python "$ROOT/backend/.venv/bin/python" -r "$ROOT/backend/requirements.txt"

(cd "$ROOT/frontend" && npm install)

"$ROOT/backend/.venv/bin/python" -m uvicorn app:app --app-dir "$ROOT/backend" --host :: --port 8000 --reload &
BACK_PID=$!
trap 'kill $BACK_PID 2>/dev/null || true' EXIT

(cd "$ROOT/frontend" && npm run dev)

#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "Checking API on http://localhost:8000 (IPv6) ..."
if curl -sS --max-time 5 'http://localhost:8000/api/health'; then
  echo
  echo "Health OK. Fetching AAPL quote ..."
  curl -sS --max-time 20 'http://localhost:8000/api/quote/AAPL'
  echo
  exit 0
fi

echo
echo "API is not reachable."
echo "Start it from the Fintopia folder in Terminal.app:"
echo "  cd \"$ROOT\" && ./start.sh"
echo
echo "Note: this Mac binds the API on IPv6. Do not use curl -4 for localhost."
exit 1

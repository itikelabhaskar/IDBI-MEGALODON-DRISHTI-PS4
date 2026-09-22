#!/bin/sh
set -e

MODE="${1:-api}"

case "$MODE" in
  api)
    echo "[DRISHTI] Starting FastAPI Serving Container on port 8000..."
    exec uv run uvicorn src.serving.api:app --host 0.0.0.0 --port 8000 --workers ${WEB_CONCURRENCY:-2}
    ;;
  batch)
    echo "[DRISHTI] Running Nightly Batch Scoring Task..."
    shift || true
    exec uv run python -m src.pipelines.score_batch "$@"
    ;;
  *)
    exec "$@"
    ;;
esac

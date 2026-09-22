# syntax=docker/dockerfile:1
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=1 \
    WEB_CONCURRENCY=2 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

# libgomp1 is required by LightGBM at runtime, curl is for healthchecks.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# Security: run as non-root user in ECS Fargate
RUN useradd -u 1000 -m -s /bin/bash drishti

WORKDIR /app

# Install dependencies first (cached layer) from the locked environment.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# application code and the trained model bundles
COPY src ./src
COPY models_store ./models_store
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh && chown -R drishti:drishti /app

USER drishti

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

ENTRYPOINT ["./entrypoint.sh"]
CMD ["api"]

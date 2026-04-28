# ── JumpShip Backend ─────────────────────────────────────────────
# Multi-stage: xhtml2pdf → svglib → pycairo needs a C toolchain to build when
# no matching manylinux wheel exists (common on arm64 / some pip versions).
# Wheels are built in `builder`; the runtime image only needs libcairo2 + curl.

FROM python:3.11-slim AS builder

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    pkg-config \
    libcairo2-dev \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --upgrade pip wheel \
    && pip wheel --no-cache-dir -r requirements.txt -w /wheels


FROM python:3.11-slim

WORKDIR /app
ENV PYTHONPATH=/app

# libcairo2: runtime for pycairo; curl: healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libcairo2 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /wheels /wheels
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir --no-index --find-links=/wheels -r requirements.txt \
    && rm -rf /wheels

# Install Playwright browser (chromium) + system deps required by playwright_scraper.py
# Adds ~150MB to image but is required for runtime; without this, scraper fails.
RUN python -m playwright install chromium --with-deps

COPY . .

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]

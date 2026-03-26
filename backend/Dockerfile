FROM python:3.11-slim

WORKDIR /app

# System dependencies for Playwright Chromium + PyMuPDF
# Installing deps manually to avoid playwright --with-deps font package issues on Debian trixie
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget curl gnupg ca-certificates \
    # Chromium core
    libnss3 libnspr4 \
    libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 \
    libasound2t64 \
    libx11-xcb1 libxcb1 libxcb-dri3-0 \
    libxi6 libxtst6 \
    # Font support (available on Debian trixie)
    fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright Chromium browser only (without --with-deps since we installed manually)
RUN playwright install chromium

# Copy source
COPY . .

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]

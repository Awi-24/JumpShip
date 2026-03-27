# ── JumpShip Backend ─────────────────────────────────────────────
FROM python:3.11-slim

WORKDIR /app

# Minimal system deps for pdfminer, python-docx, tls-client
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libxml2 \
    libxslt1.1 \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies (layer-cached unless requirements change)
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the full source (local jobspy package + backend package)
COPY . .

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]

# ── JumpShip Backend ─────────────────────────────────────────────
FROM python:3.11-slim

WORKDIR /app
ENV PYTHONPATH=/app

# System deps: curl (healthcheck); pdfminer/python-docx/fpdf2 are pure Python wheels
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the full source
COPY . .

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]

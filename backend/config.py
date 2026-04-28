"""
JumpShip — Configuration via pydantic-settings + .env
"""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings

_REPO_ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    llm_provider: str = "ollama"  # ollama | lmstudio | openai | anthropic | groq
    llm_model: str = "gemma3:27b"  # Gemma4:Cloud — tool-calling capable, runs via Ollama
    ollama_base_url: str = "http://localhost:11434"
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    groq_api_key: str = ""
    # Stored as a plain comma-separated string so any env source (docker-compose,
    # .env file, shell) works without requiring JSON-array syntax.
    # Use settings.cors_origins_list when you need a Python list.
    cors_origins: str = "http://localhost:5173,http://localhost:3000,http://localhost"
    # Secret key for encryption (Fernet)
    secret_key: str = "dev-secret-change-me-in-production"
    # Optional API key for basic authentication
    api_key: str = ""
    # Score threshold (0-100) above which a tailored resume is auto-generated
    resume_gen_threshold: int = 70
    # Directory for storing generated PDF resumes
    resume_output_dir: str = "./generated_resumes"
    # Max concurrent local LLM calls (cloud-relay models bypass this entirely)
    llm_max_concurrent: int = 1
    # When False, default SECRET_KEY raises at startup
    debug: bool = False

    class Config:
        env_file = str(_REPO_ROOT / ".env")
        env_file_encoding = "utf-8"

    @property
    def cors_origins_list(self) -> list[str]:
        """Return CORS origins as a list, supporting '*' or comma-separated URLs."""
        if not self.cors_origins or self.cors_origins.strip() == "":
            return []
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()

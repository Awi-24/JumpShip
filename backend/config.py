"""
JumpShip — Configuration via pydantic-settings + .env
"""
from __future__ import annotations

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    llm_provider: str = "ollama"  # ollama | openclaw | lmstudio | openai | anthropic | groq
    llm_model: str = "llama3"
    ollama_base_url: str = "http://localhost:11434"
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    groq_api_key: str = ""
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    class Config:
        env_file = ".env"


settings = Settings()

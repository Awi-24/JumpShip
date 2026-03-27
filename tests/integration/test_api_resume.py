"""
Integration tests for POST /api/resume/parse.
"""
import pytest
import io
from unittest.mock import AsyncMock, patch


MINIMAL_PROFILE_JSON = """{
    "name": "Ada Lovelace",
    "title": "ML Engineer",
    "skills": ["Python", "TensorFlow"],
    "experience_years": 5,
    "domains": ["MLOps"],
    "suggested_keywords": ["python", "mlops"],
    "suggested_titles": ["ML Engineer"]
}"""


class TestResumeParse:
    def _upload(self, client, content: bytes, filename: str):
        return client.post(
            "/api/resume/parse",
            files={"file": (filename, io.BytesIO(content), "application/pdf")},
        )

    def test_unsupported_type_rejected(self, client):
        resp = client.post(
            "/api/resume/parse",
            files={"file": ("resume.rtf", io.BytesIO(b"data"), "text/rtf")},
        )
        assert resp.status_code == 400

    def test_pdf_returns_profile(self, client):
        with (
            patch("backend.routers.resume_v2.extract_text", new_callable=AsyncMock) as mock_extract,
            patch("backend.routers.resume_v2.parse_profile", new_callable=AsyncMock) as mock_parse,
            patch("backend.routers.resume_v2.get_llm_service") as mock_llm_factory,
        ):
            mock_extract.return_value = "Ada Lovelace — ML Engineer..."
            mock_parse.return_value = {
                "name": "Ada Lovelace",
                "title": "ML Engineer",
                "skills": ["Python", "TensorFlow"],
                "experience_years": 5,
                "domains": ["MLOps"],
                "suggested_keywords": ["python", "mlops"],
                "suggested_titles": ["ML Engineer"],
                "raw_text": "Ada Lovelace — ML Engineer...",
            }
            mock_llm_factory.return_value = AsyncMock()

            resp = self._upload(client, b"%PDF-1.4 fake content", "ada.pdf")

        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Ada Lovelace"
        assert "Python" in data["skills"]
        assert data["experience_years"] == 5

    def test_docx_returns_profile(self, client):
        with (
            patch("backend.routers.resume_v2.extract_text", new_callable=AsyncMock) as mock_extract,
            patch("backend.routers.resume_v2.parse_profile", new_callable=AsyncMock) as mock_parse,
            patch("backend.routers.resume_v2.get_llm_service") as mock_llm_factory,
        ):
            mock_extract.return_value = "Bob Smith — Software Engineer..."
            mock_parse.return_value = {
                "name": "Bob Smith", "title": "SWE", "skills": ["Go"],
                "experience_years": 3, "domains": ["Backend"],
                "suggested_keywords": ["golang"], "suggested_titles": ["SWE"],
                "raw_text": "Bob Smith — Software Engineer...",
            }
            mock_llm_factory.return_value = AsyncMock()

            resp = client.post(
                "/api/resume/parse",
                files={"file": ("bob.docx", io.BytesIO(b"PK fake docx"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
            )

        assert resp.status_code == 200
        assert resp.json()["name"] == "Bob Smith"

    def test_empty_text_returns_422(self, client):
        with (
            patch("backend.routers.resume_v2.extract_text", new_callable=AsyncMock) as mock_extract,
            patch("backend.routers.resume_v2.get_llm_service") as mock_llm_factory,
        ):
            mock_extract.return_value = "   "  # blank
            mock_llm_factory.return_value = AsyncMock()
            resp = self._upload(client, b"%PDF-empty", "empty.pdf")

        assert resp.status_code == 422

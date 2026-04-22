"""
Unit tests for resume_parser_v2 — text extraction and LLM profile parsing.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from backend.services.resume_parser_v2 import extract_text, parse_profile


class TestExtractText:
    @pytest.mark.asyncio
    async def test_unsupported_extension_raises(self):
        with pytest.raises(ValueError, match="Unsupported file type"):
            await extract_text(b"data", "resume.rtf")

    @pytest.mark.asyncio
    async def test_pdf_calls_pdfminer(self):
        with patch("backend.services.resume_parser_v2._extract_pdf", return_value="pdf text") as mock:
            result = await extract_text(b"%PDF", "cv.pdf")
            mock.assert_called_once_with(b"%PDF")
            assert result == "pdf text"

    @pytest.mark.asyncio
    async def test_docx_calls_docx(self):
        with patch("backend.services.resume_parser_v2._extract_docx", return_value="docx text") as mock:
            result = await extract_text(b"PK", "cv.docx")
            mock.assert_called_once_with(b"PK")
            assert result == "docx text"


class TestParseProfile:
    @pytest.mark.asyncio
    async def test_valid_json_response(self):
        llm = MagicMock()
        llm.complete = MagicMock(return_value="""{
            "name": "Ada",
            "title": "ML Engineer",
            "skills": ["Python", "GCP"],
            "experience_years": 5,
            "domains": ["MLOps"],
            "suggested_keywords": ["python", "mlops"],
            "suggested_titles": ["ML Engineer"]
        }""")
        result = await parse_profile("Ada is an ML Engineer with 5 years...", llm)
        assert result["name"] == "Ada"
        assert "Python" in result["skills"]
        assert result["experience_years"] == 5
        assert "raw_text" in result

    @pytest.mark.asyncio
    async def test_json_in_markdown_fences(self):
        llm = MagicMock()
        llm.complete = MagicMock(return_value="""```json
{"name": "Bob", "title": "SWE", "skills": [], "experience_years": 2,
 "domains": [], "suggested_keywords": [], "suggested_titles": []}
```""")
        result = await parse_profile("Bob is a SWE...", llm)
        assert result["name"] == "Bob"

    @pytest.mark.asyncio
    async def test_invalid_json_returns_empty_profile(self):
        llm = MagicMock()
        llm.complete = MagicMock(return_value="I cannot parse this resume.")
        result = await parse_profile("some text", llm)
        # Should not raise; returns safe defaults
        assert result["name"] == ""
        assert result["skills"] == []
        assert "raw_text" in result

    @pytest.mark.asyncio
    async def test_raw_text_truncated_to_8000(self):
        long_text = "x" * 10000
        llm = MagicMock()
        llm.complete = MagicMock(return_value='{"name":"","title":"","skills":[],"experience_years":0,"domains":[],"suggested_keywords":[],"suggested_titles":[]}')
        result = await parse_profile(long_text, llm)
        assert len(result["raw_text"]) == 8000

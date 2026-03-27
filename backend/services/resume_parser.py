"""
Parse resume text from PDF or DOCX files.
Uses PyMuPDF for PDF and python-docx for DOCX.
"""
from __future__ import annotations

import io
from pathlib import Path


def parse_resume(file_content: bytes, filename: str) -> str:
    """
    Extract plain text from a PDF or DOCX file.
    Returns the extracted text content.
    """
    ext = Path(filename).suffix.lower()

    if ext == ".pdf":
        return _parse_pdf(file_content)
    elif ext in (".docx", ".doc"):
        return _parse_docx(file_content)
    else:
        raise ValueError(f"Unsupported file type: {ext}. Please upload a PDF or DOCX file.")


def _parse_pdf(content: bytes) -> str:
    try:
        import fitz  # PyMuPDF
    except ImportError:
        raise ImportError("PyMuPDF is required to parse PDFs. Install with: pip install pymupdf")

    doc = fitz.open(stream=content, filetype="pdf")
    pages_text = []
    for page in doc:
        pages_text.append(page.get_text())
    doc.close()

    text = "\n".join(pages_text).strip()
    if not text:
        raise ValueError("Could not extract text from the PDF. The file may be image-based or corrupted.")
    return text


def _parse_docx(content: bytes) -> str:
    try:
        from docx import Document
    except ImportError:
        raise ImportError("python-docx is required to parse DOCX files. Install with: pip install python-docx")

    doc = Document(io.BytesIO(content))
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    text = "\n".join(paragraphs).strip()

    if not text:
        raise ValueError("Could not extract text from the DOCX file. The file may be empty or corrupted.")
    return text

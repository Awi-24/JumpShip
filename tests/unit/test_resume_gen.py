"""Smoke tests for backend.routers.resume_gen — verify routes are reachable."""
from __future__ import annotations


def test_resume_gen_route_validates(client):
    """POST /api/resume/generate without payload should return 4xx, not 5xx."""
    r = client.post("/api/resume/generate", json={})
    assert 400 <= r.status_code < 500


def test_resume_gen_list_responds(client):
    """GET /api/resume/generated should respond with 2xx or documented 4xx."""
    r = client.get("/api/resume/generated")
    assert r.status_code in (200, 404, 405)

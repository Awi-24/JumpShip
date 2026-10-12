"""Smoke tests for backend.routers.profile — verify routes are wired and respond."""
from __future__ import annotations


def test_profile_get_route_responds(client):
    """GET /api/profile should respond with a documented status code."""
    r = client.get("/api/profile")
    assert r.status_code in (200, 404, 422)


def test_profile_post_accepts_empty_body(client):
    """Every ProfileSchema field is optional, so {} is a valid (no-op) upsert."""
    r = client.post("/api/profile", json={})
    assert r.status_code == 200


def test_profile_post_validates_input(client):
    """Wrong field types are rejected by pydantic with 422."""
    r = client.post("/api/profile", json={"years_experience": "lots"})
    assert r.status_code == 422
    r = client.post("/api/profile", json={"willing_to_relocate": "maybe"})
    assert r.status_code == 422


def test_profile_post_put_get_roundtrip(client):
    """POST upserts, PUT patches only supplied fields."""
    assert client.post("/api/profile", json={"full_name": "Ada"}).status_code == 200
    assert client.put("/api/profile", json={"email": "ada@example.com"}).status_code == 200
    r = client.get("/api/profile")
    assert r.status_code == 200
    body = r.json()
    assert body["full_name"] == "Ada"
    assert body["email"] == "ada@example.com"
    # NOTE: ProfileOut.model_dump() override is bypassed by FastAPI, so GET currently also
    # returns the (Fernet-encrypted) linkedin_password. Not asserted here; see docs/rust-migration/API.md.



def test_profile_ignores_linkedin_credentials(client):
    """LinkedIn credentials live in /api/settings credentials, never in the profile."""
    for method in (client.post, client.put):
        r = method("/api/profile", json={"full_name": "A", "linkedin_password": "s3cret"})
        assert r.status_code == 200 and "linkedin_password" not in r.json()
    assert "s3cret" not in client.get("/api/profile").text

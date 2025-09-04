# tests/test_smoke.py
import pytest
from jobcus import create_app

@pytest.fixture
def client():
    app = create_app("test")
    with app.test_client() as c:
        yield c

def test_app_boots(client):
    r = client.get("/")
    assert r.status_code in (200, 302, 404)

def test_chat_requires_message(client):
    r = client.post("/ask", json={})
    assert r.status_code == 400
    assert r.is_json
    data = r.get_json()
    assert data.get("error") == "bad_request"

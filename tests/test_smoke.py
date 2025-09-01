### `tests/test_smoke.py`
- A minimal test to prove the app boots and key routes respond.
- Uses `pytest`. It’s placed under `tests/` (not `tests_smoke.py` in root).

**Example:**
```python
# tests/test_smoke.py
import pytest
from jobcus import create_app

@pytest.fixture
def client():
    app = create_app()
    app.config.update(TESTING=True)
    with app.test_client() as c:
        yield c

def test_home_page(client):
    r = client.get("/")
    assert r.status_code in (200, 302)  # 302 if it redirects to a dashboard/login

def test_chat_api_rejects_empty(client):
    r = client.post("/ask", json={"message": ""})
    assert r.status_code == 400
